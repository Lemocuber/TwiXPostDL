export function tweetId(tweet) {
  const legacy = tweet.legacy || tweet;
  return legacy.id_str || tweet.rest_id;
}

export function isRetweet(tweet) {
  return Object.prototype.hasOwnProperty.call(tweet.legacy || {}, "retweeted_status_id_str");
}

export function isReply(tweet) {
  return Boolean((tweet.legacy || {}).in_reply_to_status_id_str);
}

export function tweetUser(tweet) {
  let raw = null;
  if (tweet.author) raw = tweet.author;
  else if (tweet.core) raw = tweet.core.user_results.result;
  else if (tweet.user) raw = tweet.user;
  if (!raw) return { id: null, name: null, display_name: null };
  const core = raw.core || raw;
  const legacy = raw.legacy || raw;
  return {
    id: raw.rest_id || legacy.id_str,
    name: core.screen_name,
    display_name: core.name,
  };
}

export function tweetText(tweet) {
  const legacy = tweet.legacy || tweet;
  let content;
  let entities;
  if (tweet.note_tweet) {
    const note = tweet.note_tweet.note_tweet_results.result;
    content = note.text || "";
    entities = note.entity_set || {};
  } else {
    content = legacy.full_text || legacy.text || "";
    entities = legacy.entities || {};
  }

  content = htmlUnescape(content);
  for (const url of entities.urls || []) {
    const short = url.url;
    const full = url.expanded_url;
    if (short && full) content = content.split(short).join(full);
  }

  const idx = content.lastIndexOf(" ");
  const text = idx >= 0 ? content.slice(0, idx) : "";
  const tco = idx >= 0 ? content.slice(idx + 1) : content;
  return (tco.startsWith("https://t.co/") ? text : content).trim();
}

export function tweetMedia(tweet) {
  const legacy = tweet.legacy || tweet;
  const media = (legacy.extended_entities || {}).media || [];
  const files = [];

  for (let i = 0; i < media.length; i += 1) {
    const idx = i + 1;
    const item = media[i];

    if (item.video_info) {
      let variants = item.video_info.variants || [];
      variants = variants.filter((v) => v.url && (v.content_type || "").includes("mp4"));
      if (!variants.length) continue;
      const variant = variants.reduce((a, b) => ((a.bitrate || 0) >= (b.bitrate || 0) ? a : b));
      files.push({
        idx,
        kind: item.type,
        url: variant.url,
        ext: "mp4",
        bitrate: variant.bitrate || 0,
        width: (item.original_info || {}).width || 0,
        height: (item.original_info || {}).height || 0,
        description: item.ext_alt_text,
      });
      continue;
    }

    const url = item.media_url_https || item.media_url;
    if (!url) continue;

    let base;
    let fmt;
    if (url.length > 4 && url[url.length - 4] === ".") {
      const cut = url.lastIndexOf(".");
      base = `${url.slice(0, cut)}?format=${url.slice(cut + 1)}&name=`;
      fmt = url.slice(cut + 1);
    } else {
      const cut = url.lastIndexOf("=");
      base = `${cut >= 0 ? url.slice(0, cut) : url}=`;
      fmt = extFromUrl(url, "jpg");
    }

    files.push({
      idx,
      kind: item.type,
      url: `${base}orig`,
      fallback: ["4096x4096", "large", "medium", "small"].map((s) => `${base}${s}`),
      ext: fmt,
      width: (item.original_info || {}).width || 0,
      height: (item.original_info || {}).height || 0,
      description: item.ext_alt_text,
    });
  }

  return files;
}

export function buildRecord(tweet) {
  const legacy = tweet.legacy || tweet;
  const tid = tweetId(tweet);
  const user = tweetUser(tweet);
  const text = tweetText(tweet);
  const media = tweetMedia(tweet);
  return {
    tweet_id: tid || null,
    url: tid ? `https://x.com/${user.name || "i/web"}/status/${tid}` : null,
    created_at: legacy.created_at,
    text,
    lang: legacy.lang,
    reply_to_tweet_id: legacy.in_reply_to_status_id_str,
    conversation_id: legacy.conversation_id_str,
    retweet_id: legacy.retweeted_status_id_str,
    favorite_count: legacy.favorite_count,
    quote_count: legacy.quote_count,
    reply_count: legacy.reply_count,
    retweet_count: legacy.retweet_count,
    user,
    media,
  };
}

function extFromUrl(url, fallback = "bin") {
  const pathname = new URL(url, "https://x.com/").pathname;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  return dot > -1 && dot < last.length - 1 ? last.slice(dot + 1).toLowerCase() : fallback;
}

function htmlUnescape(text) {
  return text.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/g, (_m, ent) => {
    if (ent[0] === "#") {
      const n =
        ent[1].toLowerCase() === "x"
          ? Number.parseInt(ent.slice(2), 16)
          : Number.parseInt(ent.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : `&${ent};`;
    }
    if (ent === "amp") return "&";
    if (ent === "lt") return "<";
    if (ent === "gt") return ">";
    if (ent === "quot") return '"';
    if (ent === "apos") return "'";
    return `&${ent};`;
  });
}
