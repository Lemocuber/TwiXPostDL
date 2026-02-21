import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

class CookieJar {
  constructor() {
    this.cookies = [];
  }

  loadMozilla(filePath) {
    const text = fs.readFileSync(filePath, "utf8");
    for (let line of text.split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith("#HttpOnly_")) line = line.slice(10);
      if (line.startsWith("#")) continue;
      const parts = line.split("\t");
      if (parts.length < 7) continue;
      const [domainRaw, includeSubsRaw, cookiePath, secureRaw, expiresRaw, name, ...tail] = parts;
      const value = tail.join("\t");
      const domain = domainRaw.trim();
      if (!domain || !name) continue;
      const includeSubdomains = includeSubsRaw.toUpperCase() === "TRUE" || domain.startsWith(".");
      const secure = secureRaw.toUpperCase() === "TRUE";
      const expires = Number.parseInt(expiresRaw, 10);
      this.set({
        name,
        value,
        domain,
        includeSubdomains,
        path: cookiePath || "/",
        secure,
        hostOnly: !includeSubdomains,
        expiresAt: Number.isFinite(expires) && expires > 0 ? expires : null,
      });
    }
  }

  set(cookie) {
    this.cookies = this.cookies.filter(
      (c) => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path),
    );
    this.cookies.push(cookie);
  }

  setSimple(name, value, domain = ".x.com", cookiePath = "/") {
    this.set({
      name,
      value,
      domain,
      includeSubdomains: domain.startsWith("."),
      path: cookiePath,
      secure: true,
      hostOnly: !domain.startsWith("."),
      expiresAt: null,
    });
  }

  getByName(name, domains) {
    const now = Math.floor(Date.now() / 1000);
    for (const c of this.cookies) {
      if (c.name !== name) continue;
      if (c.expiresAt && c.expiresAt <= now) continue;
      if (!domains || domains.some((d) => c.domain.includes(d))) return c.value;
    }
    return null;
  }

  cookieHeader(urlObj) {
    const now = Math.floor(Date.now() / 1000);
    const host = urlObj.hostname.toLowerCase();
    const reqPath = urlObj.pathname || "/";
    const secureReq = urlObj.protocol === "https:";

    const items = this.cookies.filter((c) => {
      if (c.expiresAt && c.expiresAt <= now) return false;
      if (c.secure && !secureReq) return false;
      const cDomain = c.domain.toLowerCase().replace(/^\./, "");
      const domainOk = c.hostOnly ? host === cDomain : host === cDomain || host.endsWith(`.${cDomain}`);
      if (!domainOk) return false;
      return reqPath.startsWith(c.path || "/");
    });

    items.sort((a, b) => (b.path || "/").length - (a.path || "/").length);
    return items.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  storeSetCookie(urlObj, headers) {
    const setCookies = getSetCookieValues(headers);
    for (const raw of setCookies) {
      const parsed = parseSetCookie(raw, urlObj);
      if (parsed) this.set(parsed);
    }
  }
}

export class HttpSession {
  constructor() {
    this.headers = {};
    this.jar = new CookieJar();
  }

  loadMozillaCookies(filePath) {
    this.jar.loadMozilla(filePath);
  }

  getCookie(name, domains) {
    return this.jar.getByName(name, domains);
  }

  setCookie(name, value, domain = ".x.com", cookiePath = "/") {
    this.jar.setSimple(name, value, domain, cookiePath);
  }

  async get(url, options = {}) {
    return this.request("GET", url, options);
  }

  async request(method, url, options = {}) {
    const { params, headers, timeoutMs = 30_000 } = options;
    const target = new URL(url);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) target.searchParams.set(k, String(v));
      }
    }

    const merged = { ...this.headers, ...(headers || {}) };
    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined || v === null) delete merged[k];
      else merged[k] = String(v);
    }

    const cookie = this.jar.cookieHeader(target);
    if (cookie) merged.Cookie = cookie;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetch(target, { method, headers: merged, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    this.jar.storeSetCookie(target, resp.headers);
    return resp;
  }

  async downloadToFile(response, filePath) {
    const body = response.body;
    if (!body) throw new Error("empty response body");
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(Readable.fromWeb(body), fs.createWriteStream(filePath));
  }
}

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? splitSetCookie(single) : [];
}

function splitSetCookie(value) {
  const out = [];
  let start = 0;
  let inExpires = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (!inExpires && value.slice(i, i + 8).toLowerCase() === "expires=") {
      inExpires = true;
      i += 7;
      continue;
    }
    if (inExpires && ch === ";") inExpires = false;
    if (!inExpires && ch === ",") {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function parseSetCookie(raw, urlObj) {
  const parts = raw.split(";").map((p) => p.trim());
  if (!parts.length) return null;
  const [namePart, ...attrs] = parts;
  const eq = namePart.indexOf("=");
  if (eq < 1) return null;
  const name = namePart.slice(0, eq);
  const value = namePart.slice(eq + 1);

  let domain = urlObj.hostname;
  let includeSubdomains = false;
  let cookiePath = defaultPath(urlObj.pathname || "/");
  let secure = false;
  let expiresAt = null;
  let hostOnly = true;

  for (const attr of attrs) {
    const [kRaw, ...vRest] = attr.split("=");
    const k = kRaw.trim().toLowerCase();
    const v = vRest.join("=").trim();
    if (k === "domain" && v) {
      domain = v.toLowerCase();
      includeSubdomains = true;
      hostOnly = false;
    } else if (k === "path" && v) {
      cookiePath = v;
    } else if (k === "secure") {
      secure = true;
    } else if (k === "max-age") {
      const sec = Number.parseInt(v, 10);
      if (Number.isFinite(sec)) expiresAt = Math.floor(Date.now() / 1000) + sec;
    } else if (k === "expires") {
      const ts = Math.floor(new Date(v).getTime() / 1000);
      if (Number.isFinite(ts)) expiresAt = ts;
    }
  }

  return {
    name,
    value,
    domain,
    includeSubdomains,
    path: cookiePath || "/",
    secure,
    hostOnly,
    expiresAt,
  };
}

function defaultPath(requestPath) {
  if (!requestPath || requestPath[0] !== "/") return "/";
  if (requestPath === "/") return "/";
  const idx = requestPath.lastIndexOf("/");
  return idx <= 0 ? "/" : requestPath.slice(0, idx);
}
