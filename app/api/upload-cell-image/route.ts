import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "crypto";
import sharp from "sharp";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 8 * 1024 * 1024;

// 10分間
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// 同一IPから10分間に最大20回
const RATE_LIMIT_MAX = 20;

const ALLOWED_FORMATS = new Set([
  "jpeg",
  "png",
  "webp",
]);

function getExtension(format: string) {
  if (format === "jpeg") return "jpg";
  if (format === "png") return "png";
  if (format === "webp") return "webp";

  return null;
}

function getContentType(format: string) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";

  return null;
}

export async function POST(request: Request) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            "Supabase環境変数が設定されていません",
        },
        { status: 500 }
      );
    }

    // -----------------------------
    // Originチェック
    // -----------------------------

    const origin = request.headers.get("origin");

    const allowedOrigins = new Set<string>();

    if (process.env.NEXT_PUBLIC_SITE_URL) {
      allowedOrigins.add(
        process.env.NEXT_PUBLIC_SITE_URL
      );
    }

    if (process.env.VERCEL_URL) {
      allowedOrigins.add(
        `https://${process.env.VERCEL_URL}`
      );
    }

    allowedOrigins.add(
      "http://localhost:3000"
    );

    if (
      !origin ||
      !allowedOrigins.has(origin)
    ) {
      return NextResponse.json(
        {
          error:
            "許可されていない送信元です",
        },
        { status: 403 }
      );
    }

    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey
    );

    // -----------------------------
    // IP取得
    // -----------------------------

    const forwarded =
      request.headers.get(
        "x-forwarded-for"
      );

    const ip =
      forwarded
        ?.split(",")[0]
        ?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    const ipHash = createHmac(
      "sha256",
      serviceRoleKey
    )
      .update(ip)
      .digest("hex");

    // -----------------------------
    // 古いログ削除
    // -----------------------------

    const oneDayAgo =
      new Date(
        Date.now() -
          24 * 60 * 60 * 1000
      ).toISOString();

    await supabaseAdmin
      .from("image_upload_logs")
      .delete()
      .lt(
        "created_at",
        oneDayAgo
      );

    // -----------------------------
    // Rate Limit
    // -----------------------------

    const windowStart =
      new Date(
        Date.now() -
          RATE_LIMIT_WINDOW_MS
      ).toISOString();

    const {
      count,
      error: countError,
    } = await supabaseAdmin
      .from("image_upload_logs")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq(
        "ip_hash",
        ipHash
      )
      .gte(
        "created_at",
        windowStart
      );

    if (countError) {
      return NextResponse.json(
        {
          error:
            countError.message,
        },
        { status: 500 }
      );
    }

    if (
      (count || 0) >=
      RATE_LIMIT_MAX
    ) {
      return NextResponse.json(
        {
          error:
            "画像アップロード回数が多すぎます。しばらくしてから再度お試しください。",
        },
        { status: 429 }
      );
    }

    // -----------------------------
    // ファイル取得
    // -----------------------------

    const formData =
      await request.formData();

    const file =
      formData.get("file");

    if (
      !file ||
      !(file instanceof File)
    ) {
      return NextResponse.json(
        {
          error:
            "画像ファイルがありません",
        },
        { status: 400 }
      );
    }

    // -----------------------------
    // サイズ制限
    // -----------------------------

    if (
      file.size <= 0 ||
      file.size > MAX_FILE_SIZE
    ) {
      return NextResponse.json(
        {
          error:
            "画像は8MB以下にしてください",
        },
        { status: 400 }
      );
    }

    const arrayBuffer =
      await file.arrayBuffer();

    const buffer =
      Buffer.from(arrayBuffer);

    // -----------------------------
    // 本当に画像か確認
    // -----------------------------

    let metadata;

    try {
      metadata = await sharp(
        buffer,
        {
          limitInputPixels:
            40_000_000,
        }
      ).metadata();
    } catch {
      return NextResponse.json(
        {
          error:
            "正しい画像ファイルではありません",
        },
        { status: 400 }
      );
    }

    const format =
      metadata.format || "";

    if (
      !ALLOWED_FORMATS.has(format)
    ) {
      return NextResponse.json(
        {
          error:
            "JPEG・PNG・WebPのみ投稿できます",
        },
        { status: 400 }
      );
    }

    if (
      !metadata.width ||
      !metadata.height
    ) {
      return NextResponse.json(
        {
          error:
            "画像サイズを確認できません",
        },
        { status: 400 }
      );
    }

    if (
      metadata.width *
        metadata.height >
      40_000_000
    ) {
      return NextResponse.json(
        {
          error:
            "画像の解像度が大きすぎます",
        },
        { status: 400 }
      );
    }

    const extension =
      getExtension(format);

    const contentType =
      getContentType(format);

    if (
      !extension ||
      !contentType
    ) {
      return NextResponse.json(
        {
          error:
            "対応していない画像形式です",
        },
        { status: 400 }
      );
    }

    // -----------------------------
    // サーバー側でファイル名生成
    // -----------------------------

    const today =
      new Date()
        .toISOString()
        .slice(0, 10);

    const filePath =
      `uploads/${today}/${randomUUID()}.${extension}`;

    // -----------------------------
    // Supabaseへアップロード
    // -----------------------------

    const {
      error: uploadError,
    } = await supabaseAdmin.storage
      .from("cell-images")
      .upload(
        filePath,
        buffer,
        {
          contentType,
          upsert: false,
          cacheControl: "3600",
        }
      );

    if (uploadError) {
      return NextResponse.json(
        {
          error:
            uploadError.message,
        },
        { status: 500 }
      );
    }

    const { data } =
      supabaseAdmin.storage
        .from("cell-images")
        .getPublicUrl(
          filePath
        );

    // 成功したアップロードを記録
    await supabaseAdmin
      .from("image_upload_logs")
      .insert([
        {
          ip_hash: ipHash,
        },
      ]);

    return NextResponse.json({
      ok: true,
      url: data.publicUrl,
      path: filePath,
    });
  } catch (error: any) {
    console.error(
      "画像アップロードエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          error.message ||
          "画像アップロードに失敗しました",
      },
      { status: 500 }
    );
  }
}