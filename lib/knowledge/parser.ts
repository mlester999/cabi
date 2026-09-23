function decodeEntities(value: string) {
  return value
    .replaceAll(/&nbsp;/giu, " ").replaceAll(/&amp;/giu, "&").replaceAll(/&lt;/giu, "<").replaceAll(/&gt;/giu, ">").replaceAll(/&quot;/giu, "\"").replaceAll(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, digits: string) => String.fromCodePoint(Number(digits)));
}

function cleanText(value: string) {
  return decodeEntities(value.replace(/<br\s*\/?\s*>/giu, "\n").replace(/<[^>]+>/gu, " "))
    .replace(/[\t\f\v ]+/gu, " ").replace(/\n\s+/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
}

export type ParsedPage = { title: string; text: string; links: string[] };

export function parsePublicHtml(html: string): ParsedPage {
  const title = cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? "Untitled page");
  const withoutNoise = html
    .replace(/<!--([\s\S]*?)-->/gu, " ")
    .replace(/<(script|style|svg|noscript|nav|footer|form|button|dialog)\b[^>]*>[\s\S]*?<\/\1>/giu, " ");
  const parts: string[] = [];
  for (const match of withoutNoise.matchAll(/<(h[1-6]|p|li|blockquote|dt|dd|article|section)\b[^>]*>([\s\S]*?)<\/\1>/giu)) {
    const text = cleanText(match[2]);
    if (text.length >= 2) parts.push(match[1].startsWith("h") ? `\n${text}\n` : text);
  }
  const links = [...withoutNoise.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/giu)].map((match) => decodeEntities(match[1]));
  const text = [...new Set(parts)].join("\n\n").replace(/\n{3,}/gu, "\n\n").trim();
  return { title: title || "Untitled page", text, links };
}
