import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return fail("送信データを読み取れませんでした。", 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("送信データが正しくありません。", 400);
  }
  const { cellId, adminKey } = input as Record<string, unknown>;
  // The existing UI sends cell.id as-is (numeric IDs or UUID strings).
  const validCellId = typeof cellId === "number"
    ? Number.isSafeInteger(cellId) && cellId > 0
    : typeof cellId === "string" && cellId.length <= 128 &&
      /^(?:[1-9][0-9]*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(cellId);
  if (!validCellId || typeof adminKey !== "string" ||
      !adminKey.trim() || adminKey.length > 1024 || adminKey.includes("\0")) {
    return fail("セル情報または管理者パスワードの入力が正しくありません。", 400);
  }
  const unavailable = () => fail("現在削除できません。時間をおいてお試しください。", 503);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const expectedKey = process.env.ADMIN_DELETE_KEY;
  if (!url || !serviceKey || !expectedKey) return unavailable();

  try {
    // Vercel's overwritten ingress header takes precedence over any override.
    const header = process.env.VERCEL === "1" ? "x-vercel-forwarded-for"
      : process.env.ADMIN_DELETE_TRUSTED_IP_HEADER;
    let ip = header ? request.headers.get(header)?.split(",")[0]?.trim() : undefined;
    if (!ip && process.env.NODE_ENV === "development") ip = "127.0.0.1";
    if (!ip || !isIP(ip)) return unavailable();
    if (isIP(ip) === 6) {
      ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
      const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(ip);
      if (mapped) {
        const high = parseInt(mapped[1], 16);
        const low = parseInt(mapped[2], 16);
        ip = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
      }
    }
    const ipHash = createHmac("sha256", process.env.ADMIN_DELETE_IP_HASH_SECRET || serviceKey)
      .update(`appicel:admin-delete:ip:${ip}`).digest("hex");
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Consume an attempt before comparing passwords; successes count too.
    const { data, error } = await admin.rpc("consume_admin_delete_attempt", { p_ip_hash: ipHash });
    if (error || !data || typeof data !== "object" || Array.isArray(data) ||
        typeof data.allowed !== "boolean" || !Number.isInteger(data.retry_after) ||
        (data.allowed ? data.retry_after !== 0 : data.retry_after < 1 || data.retry_after > 900)) {
      return unavailable();
    }
    if (!data.allowed) {
      return NextResponse.json({
        error: `認証試行の上限に達しました。${data.retry_after}秒後に再度お試しください。`,
      }, { status: 429, headers: { "Retry-After": String(data.retry_after) } });
    }
    const suppliedHash = createHash("sha256").update(adminKey).digest();
    const expectedHash = createHash("sha256").update(expectedKey).digest();
    if (!timingSafeEqual(suppliedHash, expectedHash)) {
      return fail("管理者パスワードが違います。", 401);
    }
    const { error: deleteError } = await admin.from("cells").delete().eq("id", cellId);
    if (deleteError) return fail("削除に失敗しました。時間をおいてお試しください。", 503);
    return NextResponse.json({ ok: true });
  } catch {
    return unavailable();
  }
}
