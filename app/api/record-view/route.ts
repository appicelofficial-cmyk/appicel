import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { cellId, viewerId } = body as Record<string, unknown>;
  if (
    typeof cellId !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(cellId) ||
    typeof viewerId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(viewerId)
  ) {
    return NextResponse.json({ error: "Invalid identifiers" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "PV recording is unavailable" }, { status: 503 });
  }

  // Only trust a header overwritten by the deployment's ingress proxy.
  const header = process.env.PV_TRUSTED_IP_HEADER ||
    (process.env.VERCEL === "1" ? "x-vercel-forwarded-for" : "");
  let ip = header ? request.headers.get(header)?.split(",")[0]?.trim() : undefined;
  if (!ip && process.env.NODE_ENV === "development") ip = "127.0.0.1";
  if (!ip || !isIP(ip)) {
    return NextResponse.json({ error: "Client IP is unavailable" }, { status: 503 });
  }
  // Normalize equivalent IPv6 representations before hashing.
  if (isIP(ip) === 6) ip = new URL(`http://[${ip}]/`).hostname.toLowerCase();
  const ipHash = createHmac("sha256", process.env.PV_IP_HASH_SECRET || key)
    .update(`appicel:pv:ip:${ip}`).digest("hex");

  try {
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("record_cell_view", {
      p_cell_id: cellId,
      p_viewer_id: viewerId,
      p_ip_hash: ipHash,
    });
    if (error) {
      return NextResponse.json({ error: "PV recording failed" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, recorded: data === true });
  } catch {
    return NextResponse.json({ error: "PV recording failed" }, { status: 503 });
  }
}
