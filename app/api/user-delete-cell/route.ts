import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual } from "crypto";

function hashPassword(password: string, salt: string) {
  return createHash("sha256")
    .update(`${salt}:${password}`)
    .digest("hex");
}

function safeCompare(a: string, b: string) {
  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

export async function POST(request: Request) {
  try {
    const { cellId, deletePassword } = await request.json();

    if (!cellId || !deletePassword) {
      return NextResponse.json(
        { error: "削除用パスワードを入力してください" },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase管理者キーが設定されていません" },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: passwordData, error: passwordError } = await supabaseAdmin
      .from("cell_delete_passwords")
      .select("*")
      .eq("cell_id", cellId)
      .single();

    if (passwordError || !passwordData) {
      return NextResponse.json(
        { error: "このセルには削除用パスワードが設定されていません" },
        { status: 403 }
      );
    }

    const inputHash = hashPassword(deletePassword, passwordData.salt);

    if (!safeCompare(inputHash, passwordData.password_hash)) {
      return NextResponse.json(
        { error: "削除用パスワードが違います" },
        { status: 401 }
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("cells")
      .delete()
      .eq("id", cellId);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "削除に失敗しました" },
      { status: 500 }
    );
  }
}