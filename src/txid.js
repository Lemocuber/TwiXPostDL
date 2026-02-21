import crypto from "node:crypto";

export class ClientTransaction {
  constructor() {
    this.keyBytes = Buffer.alloc(0);
    this.animationKey = "";
  }

  async initialize(session) {
    const homepage = await (await session.get("https://x.com/", { timeoutMs: 30_000 })).text();
    const key = this._extractVerificationKey(homepage);
    if (!key) throw new Error("failed to extract twitter-site-verification key");
    const ondemand = extract(homepage, '"ondemand.s":"', '"');
    if (!ondemand) throw new Error("failed to extract ondemand script id");
    const indices = await this._extractIndices(session, ondemand);
    if (!indices.length) throw new Error("failed to extract key-byte indices");
    const frames = Array.from(extractIter(homepage, 'id="loading-x-anim-', "</svg>"));
    if (!frames.length) throw new Error("failed to extract animation frame data");
    this.keyBytes = Buffer.from(`${key}===`, "base64");
    this.animationKey = this._calculateAnimationKey(frames, indices[0], this.keyBytes, indices.slice(1));
  }

  _extractVerificationKey(homepage) {
    const pos = homepage.indexOf('name="twitter-site-verification"');
    if (pos < 0) return "";
    const beg = homepage.lastIndexOf("<", pos);
    const end = homepage.indexOf(">", pos);
    return extract(homepage.slice(beg, end), 'content="', '"');
  }

  async _extractIndices(session, ondemand) {
    const url = `https://abs.twimg.com/responsive-web/client-web/ondemand.s.${ondemand}a.js`;
    const page = await (await session.get(url, { timeoutMs: 30_000 })).text();
    return [...page.matchAll(/\(\w\[(\d\d?)\],\s*16\)/g)].map((m) => Number.parseInt(m[1], 10));
  }

  _calculateAnimationKey(frames, rowIndex, keyBytes, keyBytesIndices, totalTime = 4096) {
    const frame = frames[keyBytes[5] % 4];
    const array = this._generate2dArray(frame);
    const row = array[keyBytes[rowIndex] % 16];

    let frameTime = 1;
    for (const idx of keyBytesIndices) frameTime *= keyBytes[idx] % 16;
    frameTime = roundJs(frameTime / 10) * 10;
    return this._animate(row, frameTime / totalTime);
  }

  _generate2dArray(frame) {
    const path = extract(frame, '</path><path d="', '"').slice(9);
    return path.split("C").map((part) => part.split(/[^\d]+/).filter(Boolean).map((v) => Number.parseInt(v, 10)));
  }

  _animate(frames, targetTime) {
    const curve = frames.slice(7).map((v, i) => scale(Number(v), odd(i), 1.0, false));
    const cubic = cubicValue(curve, targetTime);

    const colorA = [Number(frames[0]), Number(frames[1]), Number(frames[2])];
    const colorB = [Number(frames[3]), Number(frames[4]), Number(frames[5])];
    const color = colorA.map((a, i) => interpolate(cubic, a, colorB[i])).map((c) => (c <= 0 ? 0 : c >= 255 ? 255 : c));

    const rotation = interpolate(cubic, 0, scale(Number(frames[6]), 60, 360, true));
    const m = rotationMatrix2d(rotation);

    return [
      Math.round(color[0]).toString(16),
      Math.round(color[1]).toString(16),
      Math.round(color[2]).toString(16),
      floatToHex(Math.abs(pyRound(m[0], 2))),
      floatToHex(Math.abs(pyRound(m[1], 2))),
      floatToHex(Math.abs(pyRound(m[2], 2))),
      floatToHex(Math.abs(pyRound(m[3], 2))),
      "00",
    ].join("").replace(/\./g, "").replace(/-/g, "");
  }

  generateTransactionId(method, reqPath, keyword = "obfiowerehiring", rndnum = 3) {
    const nowf = Date.now() / 1000;
    const nowi = Math.floor(nowf);
    const now = nowi - 1682924400;
    const bytesTime = [now & 0xff, (now >> 8) & 0xff, (now >> 16) & 0xff, (now >> 24) & 0xff];

    const payload = `${method}!${reqPath}!${now}${keyword}${this.animationKey}`;
    const bytesHash = crypto.createHash("sha256").update(payload).digest().subarray(0, 16);
    const num = ((Math.floor(Math.random() * 16) << 4) + Math.floor((nowf - nowi) * 16.0)) & 0xff;

    const out = Buffer.alloc(1 + this.keyBytes.length + bytesTime.length + bytesHash.length + 1);
    let i = 0;
    out[i++] = 0 ^ num;
    for (const b of this.keyBytes) out[i++] = b ^ num;
    for (const b of bytesTime) out[i++] = b ^ num;
    for (const b of bytesHash) out[i++] = b ^ num;
    out[i] = rndnum ^ num;

    return out.toString("base64").replace(/=+$/g, "");
  }
}

function extract(text, start, end) {
  const i = text.indexOf(start);
  if (i < 0) return "";
  const from = i + start.length;
  const j = text.indexOf(end, from);
  return j >= 0 ? text.slice(from, j) : "";
}

function* extractIter(text, start, end) {
  let pos = 0;
  for (;;) {
    const i = text.indexOf(start, pos);
    if (i < 0) return;
    const j0 = text.indexOf(end, i);
    if (j0 < 0) return;
    const j = j0 + end.length;
    yield text.slice(i, j);
    pos = j;
  }
}

function cubicCalculate(a, b, m) {
  const m1 = 1.0 - m;
  return 3.0 * a * m1 * m1 * m + 3.0 * b * m1 * m * m + m * m * m;
}

function cubicValue(curve, t) {
  if (t <= 0.0) {
    if (curve[0] > 0.0) return (curve[1] / curve[0]) * t;
    if (curve[1] === 0.0 && curve[2] > 0.0) return (curve[3] / curve[2]) * t;
    return 0.0;
  }

  if (t >= 1.0) {
    if (curve[2] < 1.0) return 1.0 + ((curve[3] - 1.0) / (curve[2] - 1.0)) * (t - 1.0);
    if (curve[2] === 1.0 && curve[0] < 1.0) return 1.0 + ((curve[1] - 1.0) / (curve[0] - 1.0)) * (t - 1.0);
    return 1.0;
  }

  let lo = 0.0;
  let hi = 1.0;
  let mid = 0.0;
  while (lo < hi) {
    mid = (lo + hi) / 2.0;
    const est = cubicCalculate(curve[0], curve[2], mid);
    if (Math.abs(t - est) < 0.00001) return cubicCalculate(curve[1], curve[3], mid);
    if (est < t) lo = mid;
    else hi = mid;
  }
  return cubicCalculate(curve[1], curve[3], mid);
}

function interpolate(x, a, b) {
  return a * (1.0 - x) + b * x;
}

function rotationMatrix2d(deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, -s, s, c];
}

function floatToHex(numf) {
  const numi = Math.trunc(numf);
  let fraction = numf - numi;
  if (!fraction) return numi.toString(16);
  const out = ["."];
  let guard = 0;
  while (fraction > 0 && guard < 32) {
    fraction *= 16.0;
    const integer = Math.trunc(fraction);
    fraction -= integer;
    out.push(integer > 9 ? String.fromCharCode(integer + 87) : String(integer));
    guard += 1;
  }
  return `${numi.toString(16)}${out.join("")}`;
}

function odd(num) {
  return num % 2 ? -1.0 : 0.0;
}

function roundJs(num) {
  const floor = Math.floor(num);
  return num - floor < 0.5 ? floor : Math.ceil(num);
}

function scale(value, lo, hi, rounding) {
  const out = (value * (hi - lo)) / 255.0 + lo;
  return rounding ? Math.floor(out) : pyRound(out, 2);
}

function pyRound(num, ndigits = 0) {
  if (!Number.isFinite(num)) return num;
  const f = 10 ** ndigits;
  const x = num * f;
  const s = Math.sign(x) || 1;
  const ax = Math.abs(x);
  const i = Math.floor(ax);
  const d = ax - i;
  let r;
  if (d > 0.5) r = i + 1;
  else if (d < 0.5) r = i;
  else r = i % 2 === 0 ? i : i + 1;
  return (s * r) / f;
}
