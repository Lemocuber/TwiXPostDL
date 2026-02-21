# TwiXPostDL

Minimalist Node.js Twitter/X post downloader, provided as lightweight as possible.

- Specify one or multiple usernames
- Auth with browser cookies
- Downloads posts from target user
- Post contains text, images, and videos

Derived from `mikf/gallery-dl` (GPLv2)

## Requirements

- Node.js >=22.21.0
- A Netscape-format `cookies.txt` from X


## Usage

```bash
npm run dl -- --cookies /path/to/cookies.txt username
```

Or multiple usernames:

```bash
npm run dl -- --cookies /path/to/cookies.txt user1 user2 user3
```

Options:

| Option | Value | Description |
| --- | --- | --- |
| `--cookies`, `-c` | `/path/to/cookies.txt` | cookies file (required) |
| `--out`, `--output`, `-o` | `/output/path/` | output dir, default: `DL/<username>/` |
| `--limit`, `--max`, `-l` | `int` | max posts per username, default: no limit |
| `--media-only`, `-m` | (flag) | save only posts with media |
| `--include-retweets` | (flag) | also include reposts |
| `--include-replies` | (flag) | also include replies |
| `--dry` | (flag) | preview without operation |
| `--help`, `-?` | none | show help |


## Output Structure

```text
DL/
  <username>/
    <post_id>/
      text.txt
      metadata.json
      <post_id>_1.jpg|png|mp4
      <post_id>_2.jpg|png|mp4
```
