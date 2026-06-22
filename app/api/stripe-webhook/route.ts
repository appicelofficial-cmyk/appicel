import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe環境変数が設定されていません" },
      { status: 500 }
    );
  }

  const stripe = new Stripe(stripeSecretKey);

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  if (!signature) {
    return NextResponse.json(
      { error: "stripe-signature がありません" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: `Webhook署名エラー: ${error.message}` },
      { status: 400 }
    );
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (session.payment_status !== "paid") {
    return NextResponse.json({ received: true });
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Supabase管理者キーが設定されていません" },
      { status: 500 }
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: order, error: orderError } = await supabaseAdmin
    .from("pending_cell_orders")
    .select("*")
    .eq("stripe_session_id", session.id)
    .single();

  if (orderError || !order) {
    return NextResponse.json(
      { error: "注文データが見つかりません" },
      { status: 404 }
    );
  }

  if (order.status === "paid" || order.status === "cell_taken_refunded") {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  const payload = order.cell_payload;

  // 先に期限切れセルを削除
  await supabaseAdmin
    .from("cells")
    .delete()
    .lt("expires_at", new Date().toISOString());

  // 決済中に同じセルが埋まっていないか最終確認
  const { data: existingCell, error: existingCellError } = await supabaseAdmin
    .from("cells")
    .select("id")
    .eq("x", payload.x)
    .eq("y", payload.y)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (existingCellError) {
    return NextResponse.json(
      { error: existingCellError.message },
      { status: 500 }
    );
  }

  if (existingCell) {
    if (!paymentIntentId) {
      await supabaseAdmin
        .from("pending_cell_orders")
        .update({
          status: "refund_failed",
          error_message: "PaymentIntent が見つかりません",
        })
        .eq("id", order.id);

      return NextResponse.json(
        { error: "PaymentIntent が見つかりません" },
        { status: 500 }
      );
    }

    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          reason: "requested_by_customer",
          metadata: {
            orderId: order.id,
            reason: "cell_taken",
          },
        },
        {
          idempotencyKey: `appicel-cell-taken-refund-${order.id}`,
        }
      );

      await supabaseAdmin
        .from("pending_cell_orders")
        .update({
          status: "cell_taken_refunded",
          stripe_payment_intent: paymentIntentId,
          refund_id: refund.id,
          refund_status: refund.status,
          error_message: "決済中にセルが埋まったため自動返金しました",
        })
       .eq("id", order.id);

      return NextResponse.json({
        ok: true,
        refunded: true,
        reason: "cell_taken",
      });
    } catch (error: any) {
      await supabaseAdmin
        .from("pending_cell_orders")
        .update({
          status: "refund_failed",
          stripe_payment_intent: paymentIntentId,
          error_message: error.message || "返金に失敗しました",
        })
        .eq("id", order.id);

      return NextResponse.json(
        { error: error.message || "返金に失敗しました" },
        { status: 500 }
      );
    }
  }

  const expiresAt = new Date(
    Date.now() + Number(payload.rental_days || 1) * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: cell, error: cellError } = await supabaseAdmin
    .from("cells")
    .insert([
      {
        x: payload.x,
        y: payload.y,
        title: payload.title,
        author: payload.author,
        description: payload.description,
        link_type: payload.link_type,
        link_url: payload.link_url,
        image_url: payload.image_url,
        original_image_url: payload.original_image_url,
        expires_at: expiresAt,
        has_delete_password: payload.has_delete_password,
        plan_id: payload.plan_id,
        is_premium: payload.is_premium,
        price_yen: payload.price_yen,
        rental_days: payload.rental_days,
        viewer_id: payload.viewer_id,
        comments_enabled: payload.comments_enabled,
      },
    ])
    .select("id")
    .single();

  if (cellError) {
    return NextResponse.json(
      { error: cellError.message },
      { status: 500 }
    );
  }

  if (Array.isArray(payload.images) && payload.images.length > 0) {
    const { error: imageError } = await supabaseAdmin
      .from("cell_images")
      .insert(
        payload.images.map((image: any) => ({
          cell_id: cell.id,
          image_url: image.image_url,
          original_image_url: image.original_image_url,
          sort_order: image.sort_order,
        }))
      );

    if (imageError) {
      await supabaseAdmin.from("cells").delete().eq("id", cell.id);

      return NextResponse.json(
        { error: imageError.message },
        { status: 500 }
      );
    }
  }

  if (Array.isArray(payload.links) && payload.links.length > 0) {
    const { error: linkError } = await supabaseAdmin
      .from("cell_links")
      .insert(
        payload.links.map((link: any) => ({
          cell_id: cell.id,
          link_type: link.link_type,
          link_url: link.link_url,
          sort_order: link.sort_order,
        }))
      );

    if (linkError) {
      await supabaseAdmin.from("cells").delete().eq("id", cell.id);

      return NextResponse.json(
        { error: linkError.message },
        { status: 500 }
      );
    }
  }

  if (order.password_hash && order.password_salt) {
    const { error: passwordError } = await supabaseAdmin
      .from("cell_delete_passwords")
      .insert([
        {
          cell_id: cell.id,
          password_hash: order.password_hash,
          salt: order.password_salt,
        },
      ]);

    if (passwordError) {
      await supabaseAdmin.from("cells").delete().eq("id", cell.id);

      return NextResponse.json(
        { error: passwordError.message },
        { status: 500 }
      );
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from("pending_cell_orders")
    .update({
      status: "paid",
      stripe_payment_intent: paymentIntentId,
    })
    .eq("id", order.id);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}