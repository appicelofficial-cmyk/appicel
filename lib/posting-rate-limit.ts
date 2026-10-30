import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export type PostingScope = "create-cell" | "upload-cell-image" | "create-checkout-session";
export const POSTING_UNAVAILABLE = "現在この操作を受け付けられません。時間をおいて再度お試しください。";
const LABELS: Record<PostingScope, string> = {
  "create-cell": "無料投稿",
  "upload-cell-image": "画像アップロード",
  "create-checkout-session": "決済開始",
};

// 本番では必ず入口プロキシが上書きするヘッダーだけを信頼する。
function connectionHash(request: Request, key: string) {
  const header = process.env.VERCEL === "1"
    ? "x-vercel-forwarded-for" : process.env.POSTING_TRUSTED_IP_HEADER;
  let ip = header ? request.headers.get(header)?.split(",")[0]?.trim() : undefined;
  if (!ip && process.env.NODE_ENV === "development" && process.env.VERCEL !== "1") ip = "127.0.0.1";
  if (!ip || !isIP(ip)) throw new Error("Unavailable connection information");
  if (isIP(ip) === 6) {
    ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
    const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(ip);
    if (mapped) {
      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      ip = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
  }
  return {
    ipHash: createHmac("sha256", process.env.POSTING_IP_HASH_SECRET || key)
      .update(`appicel:posting:ip:${ip}`).digest("hex"),
    // 既存の24時間制限の過去記録を照会するためだけに使用。新規保存は禁止。
    legacyFreePostIpHash: createHash("sha256").update(ip).digest("hex"),
  };
}

// 受付済みの試行は、その後の成功・失敗にかかわらず1回。返却・自動再試行はしない。
export async function reservePostingAttempt(request: Request, scope: PostingScope) {
  const unavailable = () => ({
    ok: false as const,
    response: NextResponse.json({ error: POSTING_UNAVAILABLE }, { status: 503 }),
  });
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return unavailable();
    const { ipHash, legacyFreePostIpHash } = connectionHash(request, key);
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("consume_posting_attempt", {
      p_scope: scope, p_ip_hash: ipHash,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data) ||
        typeof data.allowed !== "boolean" || !Number.isInteger(data.retry_after) ||
        (data.allowed ? data.retry_after !== 0 : data.retry_after < 1 || data.retry_after > 600)) {
      return unavailable();
    }
    if (!data.allowed) {
      return {
        ok: false as const,
        response: NextResponse.json({
          error: `${LABELS[scope]}の回数が多くなっています。${data.retry_after}秒後に再度お試しください。入力内容はそのままでお待ちください。`,
        }, { status: 429, headers: { "Retry-After": String(data.retry_after) } }),
      };
    }
    return { ok: true as const, admin, ipHash, legacyFreePostIpHash };
  } catch {
    return unavailable();
  }
}
