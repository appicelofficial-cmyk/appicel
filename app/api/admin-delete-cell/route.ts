import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const { cellId, adminKey } = await request.json();

    if (!cellId) {
      return NextResponse.json(
        { error: "cellId がありません" },
        { status: 400 }
      );
    }

    if (!process.env.ADMIN_DELETE_KEY) {
      return NextResponse.json(
        { error: "ADMIN_DELETE_KEY が設定されていません" },
        { status: 500 }
      );
    }

    if (adminKey !== process.env.ADMIN_DELETE_KEY) {
      return NextResponse.json(
        { error: "管理者パスワードが違います" },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase 管理者キーが設定されていません" },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { error } = await supabaseAdmin
      .from("cells")
      .delete()
      .eq("id", cellId);

    if (error) {
      return NextResponse.json(
        { error: error.message },
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