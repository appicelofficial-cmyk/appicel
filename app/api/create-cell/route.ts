import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

function hashIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");

  const ip =
    forwardedFor?.split(",")[0]?.trim() ||
    realIp?.trim() ||
    "unknown";

  return createHash("sha256").update(ip).digest("hex");
}

async function countFreePosts(
  supabaseAdmin: any,
  viewerId: string,
  ipHash: string
) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: viewerCount } = await supabaseAdmin
    .from("free_cell_posts")
    .select("id", { count: "exact", head: true })
    .eq("viewer_id", viewerId)
    .gte("created_at", since);

  const { count: ipCount } = await supabaseAdmin
    .from("free_cell_posts")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  return Math.max(viewerCount || 0, ipCount || 0);
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
      link_type,
      link_url,
      images,
      image_url,
      original_image_url,
    } = body;

    const selectedPlanId = String(planId || "normal_free_1d") as PlanId;
    const plan = PLANS[selectedPlanId];

    if (!plan) {
      return NextResponse.json(
        { error: "プランが正しくありません" },
        { status: 400 }
      );
    }

    if (plan.priceYen > 0) {
      return NextResponse.json(
        { error: "有料プランはStripe決済実装後に利用できます" },
        { status: 400 }
      );
    }

    const finalTitle = String(title || "").trim().slice(0, 15);
    const finalAuthor = String(author || "").trim().slice(0, 10) || "名無し";
    const finalDescription = String(description || "")
      .trim()
      .slice(0, plan.descriptionMax);

    const finalDeletePassword = String(deletePassword || "").trim();

    const rawLinks = Array.isArray(links)
      ? links
      : [
          {
            link_type,
            link_url,
          },
        ];

    const finalLinks = rawLinks
      .map((link: any, index: number) => ({
        link_type: String(link.link_type || "other").trim() || "other",
        link_url: String(link.link_url || "").trim(),
        sort_order: index,
      }))
      .filter((link: any) => link.link_url);

    if (finalLinks.length > plan.linkMax) {
      return NextResponse.json(
        { error: `リンクは最大${plan.linkMax}個までです` },
        { status: 400 }
      );
    }

    const rawImages = Array.isArray(images)
      ? images
      : [
          {
            image_url,
            original_image_url,
          },
        ];

    const finalImages = rawImages
      .map((image: any, index: number) => ({
        image_url: String(image.image_url || "").trim(),
        original_image_url: String(
          image.original_image_url || image.image_url || ""
        ).trim(),
        sort_order: index,
      }))
      .filter((image: any) => image.image_url && image.original_image_url);

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

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase管理者キーが設定されていません" },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const ipHash = hashIp(request);
    const finalViewerId = String(viewerId || "").trim();

    if (selectedPlanId === "normal_free_1d") {
      if (!finalViewerId) {
        return NextResponse.json(
          { error: "viewer_id がありません" },
          { status: 400 }
        );
      }

      const freePostCount = await countFreePosts(
        supabaseAdmin,
        finalViewerId,
        ipHash
      );

      if (freePostCount >= 3) {
        return NextResponse.json(
          { error: "無料通常1日セルは1人1日3回までです" },
          { status: 429 }
        );
      }
    }

    const expiresAt = new Date(
      Date.now() + plan.rentalDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const firstLink = finalLinks[0];
    const firstImage = finalImages[0];

    const { data: cell, error: cellError } = await supabaseAdmin
      .from("cells")
      .insert([
        {
          x,
          y,
          title: finalTitle,
          author: finalAuthor,
          description: finalDescription,
          link_type: firstLink?.link_type || null,
          link_url: firstLink?.link_url || null,
          image_url: firstImage.image_url,
          original_image_url: firstImage.original_image_url,
          expires_at: expiresAt,
          has_delete_password: Boolean(finalDeletePassword),
          plan_id: selectedPlanId,
          is_premium: plan.isPremium,
          price_yen: plan.priceYen,
          rental_days: plan.rentalDays,
          viewer_id: finalViewerId,
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

    const { error: imageError } = await supabaseAdmin
      .from("cell_images")
      .insert(
        finalImages.map((image: any) => ({
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

    if (finalLinks.length > 0) {
      const { error: linkError } = await supabaseAdmin
        .from("cell_links")
        .insert(
          finalLinks.map((link: any) => ({
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

    if (finalDeletePassword) {
      const salt = randomBytes(16).toString("hex");
      const passwordHash = hashPassword(finalDeletePassword, salt);

      const { error: passwordError } = await supabaseAdmin
        .from("cell_delete_passwords")
        .insert([
          {
            cell_id: cell.id,
            password_hash: passwordHash,
            salt,
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

    if (selectedPlanId === "normal_free_1d") {
      const { error: freePostError } = await supabaseAdmin
        .from("free_cell_posts")
        .insert([
          {
            viewer_id: finalViewerId,
            ip_hash: ipHash,
            cell_id: cell.id,
          },
        ]);

      if (freePostError) {
        await supabaseAdmin.from("cells").delete().eq("id", cell.id);

        return NextResponse.json(
          { error: freePostError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true, cellId: cell.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "投稿に失敗しました" },
      { status: 500 }
    );
  }
}