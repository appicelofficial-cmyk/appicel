import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json(
        { error: "session_id がありません" },
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

    const { data: order, error } = await supabaseAdmin
      .from("pending_cell_orders")
      .select("status, refund_status, error_message")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!order) {
      return NextResponse.json({
        status: "not_found",
        message: "注文情報を確認中です",
      });
    }

    return NextResponse.json({
      status: order.status,
      refund_status: order.refund_status,
      error_message: order.error_message,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "決済結果の確認に失敗しました" },
      { status: 500 }
    );
  }
}