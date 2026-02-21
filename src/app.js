import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TwitterClient } from "./client.js";
import { normalizeUsername } from "./extract.js";
import { recordBase, saveRecord } from "./output.js";
import { buildRecord, isReply, isRetweet, tweetId } from "./tweet.js";

function runArgs(argv) {
  const args = {
    usernames: [],
    cookies: null,
    out: "DL/",
    outSet: false,
    limit: null,
    includeRetweets: false,
    includeReplies: false,
    mediaOnly: false,
    metadata: false,
    dry: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-?") return { help: true };
    if (a === "--cookies" || a === "-c") args.cookies = nextValue(argv, ++i, "--cookies");
    else if (a === "--out" || a === "--output" || a === "-o") {
      args.out = nextValue(argv, ++i, "--out");
      args.outSet = true;
    }
    else if (a === "--limit" || a === "--max" || a === "-l") {
      const v = nextValue(argv, ++i, "--limit");
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n)) throw new Error("--limit must be an integer");
      args.limit = n;
    } else if (a === "--include-retweets") args.includeRetweets = true;
    else if (a === "--media-only" || a === "-m") args.mediaOnly = true;
    else if (a === "--include-replies") args.includeReplies = true;
    else if (a === "--metadata") args.metadata = true;
    else if (a === "--dry") args.dry = true;
    else if (a.startsWith("-")) throw new Error(`unrecognized option: ${a}`);
    else args.usernames.push(a);
  }

  if (!args.cookies) throw new Error("--cookies is required");
  if (!args.usernames.length) throw new Error("at least one username is required");
  return args;
}

function nextValue(argv, idx, name) {
  if (idx >= argv.length) throw new Error(`expected value for ${name}`);
  return argv[idx];
}

function helpText() {
  return [
    "TwiXPostDL",
    "",
    "Minimalist Node.js Twitter/X post downloader, provided as lightweight as possible.",
    "",
    "Usage:",
    "  npm run dl -- --cookies /path/to/cookies.txt username [username ...]",
    "",
    "Options:",
    "  --cookies, -c PATH      cookies file (required)",
    "  --out, --output, -o DIR output dir, default: DL/<username>/",
    "  --limit, --max, -l INT  max posts per username, default: no limit",
    "  --media-only, -m        save only posts with media",
    "  --include-retweets      also include reposts",
    "  --include-replies       also include replies",
    "  --metadata              write metadata.json",
    "  --dry                   preview without operation",
    "  --help, -?              show help",
  ].join("\n");
}

async function run(args) {
  const outRoot = path.resolve(expandHome(args.out));
  const cookies = path.resolve(expandHome(args.cookies));
  if (!fs.existsSync(cookies) || !fs.statSync(cookies).isFile()) {
    throw new Error(`cookies file not found: ${cookies}`);
  }
  if (args.limit !== null && args.limit <= 0) throw new Error("--limit must be > 0");
  const users = args.usernames.map((u) => normalizeUsername(u));

  const client = new TwitterClient(cookies);
  await client.initialize();

  const limit = args.limit;
  const fetchLimit = 1_000_000_000;
  let total = 0;
  let totalExisting = 0;
  let totalFiltered = 0;

  for (const user of users) {
    const out = args.outSet ? outRoot : path.join(outRoot, user);
    let saved = 0;
    let existing = 0;
    let filtered = 0;
    const seen = new Set();
    try {
      const pending = [];
      let fetchedTotal = 0;
      for await (const tweet of client.iterUserTweets(user, fetchLimit)) {
        const tid = tweetId(tweet);
        if (!tid || seen.has(tid)) continue;
        seen.add(tid);
        fetchedTotal += 1;
        if (!args.includeRetweets && isRetweet(tweet)) {
          filtered += 1;
          totalFiltered += 1;
          continue;
        }
        if (!args.includeReplies && isReply(tweet)) {
          filtered += 1;
          totalFiltered += 1;
          continue;
        }

        const record = buildRecord(tweet);
        if (args.mediaOnly && !record.media.length) {
          filtered += 1;
          totalFiltered += 1;
          continue;
        }
        const base = recordBase(out, record);
        if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
          existing += 1;
          totalExisting += 1;
          continue;
        }

        pending.push(record);
        if (limit && pending.length >= limit) break;
      }

      console.log(`${user}: fetched ${fetchedTotal} post(s)`);
      const toSave = pending;
      console.log(`${user}: downloading ${toSave.length} eligible post(s)`);

      for (let i = 0; i < toSave.length; i += 1) {
        const record = toSave[i];
        console.log(`${user}: saving (${i + 1}/${toSave.length}) ${record.url}`);
        await saveRecord(client.session, out, record, args.dry, args.metadata);
        saved += 1;
        total += 1;
      }
    } catch (err) {
      console.log(`${user}: error: ${err.message || err}`);
      continue;
    }

    console.log(`${user}: saved ${saved} post(s), skipped ${existing} existing, skipped ${filtered} filtered`);
  }

  const outInfo = args.outSet ? outRoot : path.join(outRoot, "<username>");
  console.log(`total saved ${total} post(s), skipped ${totalExisting} existing, skipped ${totalFiltered} filtered to ${outInfo}`);
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

try {
  const args = runArgs(process.argv.slice(2));
  if (args.help) console.log(helpText());
  else await run(args);
} catch (err) {
  console.error(err.message || String(err));
  process.exitCode = 1;
}
