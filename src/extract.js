const RE_USER_URL = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:twitter|x)\.com\/([^/?#]+)/;
const RE_STATUS_URL = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:twitter|x)\.com\/[^/?#]+\/status\/\d+/;
const RESERVED = new Set([
  "home",
  "explore",
  "search",
  "hashtag",
  "i",
  "notifications",
  "messages",
  "compose",
  "settings",
  "tos",
  "privacy",
  "intent",
  "share",
]);

export function normalizeUsername(value) {
  const raw = value.trim();
  if (RE_STATUS_URL.test(raw)) throw new Error("single-post URLs are not supported; pass username only");
  if (raw.startsWith("@")) return raw.slice(1);
  const m = raw.match(RE_USER_URL);
  if (!m) return raw;
  const name = m[1];
  if (RESERVED.has(name)) throw new Error(`unsupported username target: ${value}`);
  return name;
}
