import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return fail("投稿データを読み取れませんでした。", 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("投稿データが正しくありません。", 400);
  }
  const { cellId, viewerId, author, body } = input as Record<string, unknown>;
  if (typeof cellId !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(cellId) ||
      typeof viewerId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(viewerId)) {
    return fail("投稿者またはセルの情報が正しくありません。再読み込みしてください。", 400);
  }
  if (typeof author !== "string" || typeof body !== "string" ||
      author.includes("\0") || body.includes("\0")) {
    return fail("名前と本文を正しい文字列で入力してください。", 400);
  }
  if (author.length > 10 || body.length > 150) {
    return fail("名前は10文字、本文は150文字以内で入力してください。", 400);
  }
  const finalBody = body.trim();
  if (!finalBody) return fail("本文を入力してください。", 400);
  const finalAuthor = author.trim() || "名無し";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return fail("現在コメントを投稿できません。時間をおいてお試しください。", 503);

  // Trust only an ingress header that the deployment proxy always overwrites.
  const header = process.env.COMMENT_TRUSTED_IP_HEADER || process.env.PV_TRUSTED_IP_HEADER ||
    (process.env.VERCEL === "1" ? "x-vercel-forwarded-for" : "");
  let ip = header ? request.headers.get(header)?.split(",")[0]?.trim() : undefined;
  if (!ip && process.env.NODE_ENV === "development") ip = "127.0.0.1";
  if (!ip || !isIP(ip)) return fail("接続情報を確認できません。時間をおいてお試しください。", 503);
  if (isIP(ip) === 6) {
    ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
    // IPv4-mapped IPv6 must share the IPv4 rate limit.
    const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(ip);
    if (mapped) {
      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      ip = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
  }
  const ipHash = createHmac("sha256", process.env.COMMENT_IP_HASH_SECRET || key)
    .update(`appicel:comment:ip:${ip}`).digest("hex");

  try {
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("create_cell_comment", {
      p_cell_id: cellId, p_viewer_id: viewerId.toLowerCase(),
      p_ip_hash: ipHash, p_author: finalAuthor, p_body: finalBody,
    });
    if (error) return fail("投稿に失敗しました。時間をおいてお試しください。", 503);
    switch (data) {
      case "created": return NextResponse.json({ ok: true }, { status: 201 });
      case "rate_limited":
        return NextResponse.json({ error: "連続投稿はできません。30秒以上あけて再度投稿してください。" },
          { status: 429, headers: { "Retry-After": "30" } });
      case "not_found": return fail("このセルは削除されたか、存在しません。", 404);
      case "comments_disabled": return fail("このセルはコメント欄がオフです。", 403);
      case "comment_limit": return fail("コメントは最大100件までです。", 409);
      default: return fail("投稿に失敗しました。時間をおいてお試しください。", 503);
    }
  } catch {
    return fail("通信に失敗しました。時間をおいてお試しください。", 503);
  }
}
