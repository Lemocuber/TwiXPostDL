import fs from "node:fs";
import path from "node:path";

export function recordBase(outRoot, record) {
  const tid = String(record.tweet_id || "unknown");
  return path.join(outRoot, tid);
}

export async function saveRecord(session, outRoot, record, dryRun = false) {
  const base = recordBase(outRoot, record);
  const tid = String(record.tweet_id || "unknown");

  if (dryRun) {
    console.log(`[dry-run] ${record.url} media=${record.media.length} -> ${base}`);
    return;
  }

  await fs.promises.mkdir(base, { recursive: true });
  const text = stripHashtags(record.text || "");
  await fs.promises.writeFile(path.join(base, "text.txt"), `${text}\n`, "utf8");

  const mediaState = [];
  for (const m of record.media) {
    const filePath = path.join(base, mediaFilename(tid, m.idx, m.ext));
    const [url, ok] = await downloadMedia(session, m, filePath);
    const row = {
      idx: m.idx,
      kind: m.kind,
      url,
      file: ok ? path.basename(filePath) : null,
      downloaded: ok,
      width: m.width,
      height: m.height,
      description: m.description,
    };
    if (Object.prototype.hasOwnProperty.call(m, "bitrate")) row.bitrate = m.bitrate;
    mediaState.push(row);
  }

  const data = { ...record, media: mediaState };
  await fs.promises.writeFile(path.join(base, "metadata.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function downloadMedia(session, media, filePath) {
  const urls = [media.url, ...(media.fallback || [])];
  for (const url of urls) {
    let resp;
    try {
      resp = await session.get(url, { timeoutMs: 60_000 });
    } catch {
      continue;
    }
    if (resp.status >= 400) {
      await resp.arrayBuffer().catch(() => {});
      continue;
    }
    await session.downloadToFile(resp, filePath);
    return [url, true];
  }
  return [urls[0], false];
}

function mediaFilename(tweetId, idx, ext) {
  return `${tweetId}_${idx}.${(ext || "bin").toLowerCase()}`;
}

function stripHashtags(text) {
  return text
    .replace(/(?<!\S)#\w+\b/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}
