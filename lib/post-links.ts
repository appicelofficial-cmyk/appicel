export const POST_LINK_ERROR = "リンクURLは example.com または https://example.com の形式で入力してください。http・https以外の方式や制御文字は使えません。";

type LinkResult = { ok: true; url: string } | { ok: false; error: string };

// 投稿リンク専用。画像URLや決済の戻り先には使用しない。
export function validatePostLink(value: unknown): LinkResult {
  if (value == null) return { ok: true, url: "" };
  if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    return { ok: false, error: POST_LINK_ERROR };
  }
  const input = value.trim();
  if (!input) return { ok: true, url: "" };
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(input);
  if (scheme && !/^https?:$/i.test(scheme[0])) {
    return { ok: false, error: POST_LINK_ERROR };
  }
  try {
    const url = new URL(scheme ? input : `https://${input}`);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) {
      return { ok: true, url: url.href };
    }
  } catch { /* URLとして解釈できない入力 */ }
  return { ok: false, error: POST_LINK_ERROR };
}

type PostLink = { link_type: string; link_url: string; sort_order: number };
export function validatePostLinks(values: unknown):
  | { ok: true; links: PostLink[] }
  | { ok: false; error: string } {
  const links: PostLink[] = [];
  if (!Array.isArray(values)) return { ok: true, links };
  for (const [index, link] of values.entries()) {
    const result = validatePostLink(link?.link_url);
    if (!result.ok) return { ok: false, error: `リンク${index + 1}: ${result.error}` };
    if (result.url) links.push({
      link_type: String(link?.link_type || "other").trim() || "other",
      link_url: result.url,
      sort_order: index,
    });
  }
  return { ok: true, links };
}

// 既存投稿は書き換えず、安全に遷移できるリンクだけを表示する。
export function postLinkHref(value: unknown): string | undefined {
  const result = validatePostLink(value);
  return result.ok && result.url ? result.url : undefined;
}
