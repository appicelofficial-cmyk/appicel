import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";

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
      link_type,
      link_url,
      image_url,
      original_image_url,
      deletePassword,
    } = body;

    const finalTitle = String(title || "").trim().slice(0, 15);
    const finalAuthor = String(author || "").trim().slice(0, 10) || "名無し";
    const finalDescription = String(description || "").trim().slice(0, 200);
    const finalDeletePassword = String(deletePassword || "").trim();

    if (!finalTitle) {
      return NextResponse.json(
        { error: "タイトルを入力してください" },
        { status: 400 }
      );
    }

    if (!image_url) {
      return NextResponse.json(
        { error: "画像を選択してください" },
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

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { data: cell, error: cellError } = await supabaseAdmin
      .from("cells")
      .insert([
        {
          x,
          y,
          title: finalTitle,
          author: finalAuthor,
          description: finalDescription,
          link_type,
          link_url,
          image_url,
          original_image_url,
          expires_at: expiresAt,
          has_delete_password: Boolean(finalDeletePassword),
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

    return NextResponse.json({ ok: true, cellId: cell.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "投稿に失敗しました" },
      { status: 500 }
    );
  }
}