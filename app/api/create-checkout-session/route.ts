import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { createHash, randomBytes } from "crypto";

const PLANS = {
  normal_free_1d: {
    label: "リリース記念：通常1日無料",
    priceYen: 0,
    rentalDays: 1,
    isPremium: false,
    descriptionMax: 200,
    linkMax: 2,
    imageMax: 2,
  },
  normal_1d: {
    label: "通常1日",
    priceYen: 100,
    rentalDays: 1,
    isPremium: false,
    descriptionMax: 200,
    linkMax: 2,
    imageMax: 2,
  },
  normal_7d: {
    label: "通常7日",
    priceYen: 600,
    rentalDays: 7,
    isPremium: false,
    descriptionMax: 200,
    linkMax: 2,
    imageMax: 2,
  },
  normal_30d: {
    label: "通常30日",
    priceYen: 2500,
    rentalDays: 30,
    isPremium: false,
    descriptionMax: 200,
    linkMax: 2,
    imageMax: 2,
  },
  premium_1d: {
    label: "プレミアム1日",
    priceYen: 250,
    rentalDays: 1,
    isPremium: true,
    descriptionMax: 500,
    linkMax: 5,
    imageMax: 5,
  },
  premium_7d: {
    label: "プレミアム7日",
    priceYen: 1500,
    rentalDays: 7,
    isPremium: true,
    descriptionMax: 500,
    linkMax: 5,
    imageMax: 5,
  },
  premium_30d: {
    label: "プレミアム30日",
    priceYen: 6000,
    rentalDays: 30,
    isPremium: true,
    descriptionMax: 500,
    linkMax: 5,
    imageMax: 5,
  },
} as const;

type PlanId = keyof typeof PLANS;

function hashPassword(password: string, salt: string) {
  return createHash("sha256")
    .update(`${salt}:${password}`)
    .digest("hex");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      x,
      y,
      title,
      author,
      description,
      deletePassword,
      planId,
      viewerId,
      links,
      images,
      commentsDisabled,
    } = body;

    const selectedPlanId = String(planId || "") as PlanId;
    const plan = PLANS[selectedPlanId];

    if (!plan) {
      return NextResponse.json(
        { error: "プランが正しくありません" },
        { status: 400 }
      );
    }

    if (plan.priceYen <= 0) {
      return NextResponse.json(
        { error: "無料プランは決済不要です" },
        { status: 400 }
      );
    }

    const finalTitle = String(title || "").trim().slice(0, 15);
    const finalAuthor = String(author || "").trim().slice(0, 10) || "名無し";
    const finalDescription = String(description || "")
      .trim()
      .slice(0, plan.descriptionMax);

    const finalDeletePassword = String(deletePassword || "").trim();

    if (!finalTitle) {
      return NextResponse.json(
        { error: "タイトルを入力してください" },
        { status: 400 }
      );
    }

    if (finalDeletePassword && finalDeletePassword.length < 4) {
      return NextResponse.json(
        { error: "削除用パスワードは4文字以上にしてください" },
        { status: 400 }
      );
    }

    const finalLinks = Array.isArray(links)
      ? links
          .map((link: any, index: number) => ({
            link_type: String(link.link_type || "other").trim() || "other",
            link_url: String(link.link_url || "").trim(),
            sort_order: index,
          }))
          .filter((link: any) => link.link_url)
      : [];

    if (finalLinks.length > plan.linkMax) {
      return NextResponse.json(
        { error: `リンクは最大${plan.linkMax}個までです` },
        { status: 400 }
      );
    }

    const finalImages = Array.isArray(images)
      ? images
          .map((image: any, index: number) => ({
            image_url: String(image.image_url || "").trim(),
            original_image_url: String(
              image.original_image_url || image.image_url || ""
            ).trim(),
            sort_order: index,
          }))
          .filter((image: any) => image.image_url && image.original_image_url)
      : [];

    if (finalImages.length === 0) {
      return NextResponse.json(
        { error: "画像を選択してください" },
        { status: 400 }
      );
    }

    if (finalImages.length > plan.imageMax) {
      return NextResponse.json(
        { error: `画像は最大${plan.imageMax}枚までです` },
        { status: 400 }
      );
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!stripeSecretKey) {
      return NextResponse.json(
        { error: "STRIPE_SECRET_KEY が設定されていません" },
        { status: 500 }
      );
    }

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase管理者キーが設定されていません" },
        { status: 500 }
      );
    }

    const stripe = new Stripe(stripeSecretKey);
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 期限切れセルを削除
    await supabaseAdmin
      .from("cells")
      .delete()
      .lt("expires_at", new Date().toISOString());

    // 決済開始前にセルが空いているか確認
    const { data: existingCell, error: existingCellError } = await supabaseAdmin
      .from("cells")
      .select("id")
      .eq("x", x)
      .eq("y", y)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (existingCellError) {
      return NextResponse.json(
        { error: existingCellError.message },
        { status: 500 }
      );
    }

    if (existingCell) {
      return NextResponse.json(
        { error: "このセルはすでに埋まっています" },
        { status: 409 }
      );
    }

    const firstLink = finalLinks[0];
    const firstImage = finalImages[0];

    const commentsEnabled = plan.isPremium
      ? !Boolean(commentsDisabled)
      : true;

    const cellPayload = {
      x,
      y,
      title: finalTitle,
      author: finalAuthor,
      description: finalDescription,
      link_type: firstLink?.link_type || null,
      link_url: firstLink?.link_url || null,
      image_url: firstImage.image_url,
      original_image_url: firstImage.original_image_url,
      has_delete_password: Boolean(finalDeletePassword),
      plan_id: selectedPlanId,
      is_premium: plan.isPremium,
      price_yen: plan.priceYen,
      rental_days: plan.rentalDays,
      viewer_id: String(viewerId || "").trim(),
      comments_enabled: commentsEnabled,
      links: finalLinks,
      images: finalImages,
    };

    let passwordHash = null;
    let passwordSalt = null;

    if (finalDeletePassword) {
      passwordSalt = randomBytes(16).toString("hex");
      passwordHash = hashPassword(finalDeletePassword, passwordSalt);
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("pending_cell_orders")
      .insert([
        {
          plan_id: selectedPlanId,
          status: "pending",
          cell_payload: cellPayload,
          password_hash: passwordHash,
          password_salt: passwordSalt,
        },
      ])
      .select("id")
      .single();

    if (orderError) {
      return NextResponse.json(
        { error: orderError.message },
        { status: 500 }
      );
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "ja",
      client_reference_id: order.id,
      metadata: {
        orderId: order.id,
        planId: selectedPlanId,
      },
      line_items: [
        {
          price_data: {
            currency: "jpy",
            unit_amount: plan.priceYen,
            product_data: {
              name: `Appicel ${plan.label}`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/?payment=cancel`,
    });

    const { error: updateError } = await supabaseAdmin
      .from("pending_cell_orders")
      .update({
        stripe_session_id: session.id,
      })
      .eq("id", order.id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      url: session.url,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "決済ページの作成に失敗しました" },
      { status: 500 }
    );
  }
}