const TOOL_TAG_RE = /<([a-z][a-z0-9_-]{2,80})\b[^>]*>([\s\S]*?)<\/\1>/gi;
const SELF_CLOSING_TOOL_TAG_RE = /<([a-z][a-z0-9_-]{2,80})\b([^>]*)\/>/gi;
const JIUWEN_PERMISSION_MARKER_RE = /<!--EA_JIUWEN_PERMISSION:[A-Za-z0-9+/=]+-->/g;

function looksLikeToolTag(tagName: string) {
  return tagName.includes("_") || tagName.includes("-");
}

function tryParseJsonLike(value: string): unknown {
  const text = value.trim();
  if (!text) return null;
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizeJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value.slice(0, 3).map(summarizeJson).filter(Boolean).join("; ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .slice(0, 5)
      .map(([key, item]) => {
        const summary = summarizeJson(item);
        return summary ? `${key}: ${summary}` : key;
      })
      .join("; ");
  }
  return "";
}

function normalizeToolName(tagName: string) {
  return tagName.replace(/[-_]+/g, " ").trim();
}

export function cleanLeakedToolTags(content: string): string {
  if (!content) return content;
  content = content.replace(JIUWEN_PERMISSION_MARKER_RE, "").replace(/\n{4,}/g, "\n\n\n").trim();
  if (!content || (!content.includes("<") && !content.includes(">"))) return content;

  let cleaned = content.replace(TOOL_TAG_RE, (match, rawTagName: string, body: string) => {
    const tagName = String(rawTagName || "").toLowerCase();
    if (!looksLikeToolTag(tagName)) return match;
    const parsed = tryParseJsonLike(body);
    if (parsed == null) return match;
    const summary = summarizeJson(parsed);
    const label = normalizeToolName(tagName);
    return summary ? `\n\n[工具调用：${label} · ${summary}]\n\n` : `\n\n[工具调用：${label}]\n\n`;
  });

  cleaned = cleaned.replace(SELF_CLOSING_TOOL_TAG_RE, (match, rawTagName: string) => {
    const tagName = String(rawTagName || "").toLowerCase();
    if (!looksLikeToolTag(tagName)) return match;
    return `\n\n[工具调用：${normalizeToolName(tagName)}]\n\n`;
  });

  return cleaned.replace(/\n{4,}/g, "\n\n\n");
}
