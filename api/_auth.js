import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "commitcast_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function sitePassword() {
  return process.env.COMMITCAST_SITE_PASSWORD ?? "";
}

export function sessionSecret() {
  return process.env.COMMITCAST_SESSION_SECRET?.trim() || sitePassword();
}

export function passwordsMatch(provided) {
  const expected = sitePassword();
  if (!expected || typeof provided !== "string") {
    return false;
  }

  const actual = Buffer.from(provided, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (actual.length !== wanted.length) {
    const dummy = Buffer.alloc(wanted.length || 1);
    timingSafeEqual(dummy, Buffer.alloc(dummy.length, 1));
    return false;
  }

  return timingSafeEqual(actual, wanted);
}

export function signSession() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `v1.${exp}`;
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function isAuthenticated(request) {
  const token = readCookie(request, SESSION_COOKIE);
  const secret = sessionSecret();
  if (!token || !secret) {
    return false;
  }

  const separator = token.lastIndexOf(".");
  if (separator < 0) {
    return false;
  }

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const actualBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return false;
  }

  const exp = Number(payload.split(".")[1]);
  return Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
}

export function requireAuth(request, response) {
  if (isAuthenticated(request)) {
    return true;
  }

  const path = request.url ? new URL(request.url, "https://commitcast.vercel.app").pathname : "/";
  const search = request.url ? new URL(request.url, "https://commitcast.vercel.app").search : "";
  const next = `${path}${search}`;
  response.statusCode = 302;
  response.setHeader("Location", `/login?next=${encodeURIComponent(next || "/")}`);
  response.end();
  return false;
}

export function safeNextPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export function readCookie(request, name) {
  const header = headerValue(request.headers?.cookie) ?? headerValue(request.headers?.Cookie) ?? "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      continue;
    }
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return "";
}

function headerValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
