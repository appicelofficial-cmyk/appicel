import { POSTING_UNAVAILABLE, reservePostingAttempt } from "../../../lib/posting-rate-limit";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import sharp from "sharp";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 8 * 1024 * 1024;

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

    const attempt = await reservePostingAttempt(request, "upload-cell-image");
    if (!attempt.ok) return attempt.response;
    const supabaseAdmin = attempt.admin;

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
            POSTING_UNAVAILABLE,
        },
        { status: 503 }
      );
    }

    const { data } =
      supabaseAdmin.storage
        .from("cell-images")
        .getPublicUrl(
          filePath
        );

    return NextResponse.json({
      ok: true,
      url: data.publicUrl,
      path: filePath,
    });
  } catch {
    return NextResponse.json(
      { error: POSTING_UNAVAILABLE },
      { status: 503 }
    );
  }
}
