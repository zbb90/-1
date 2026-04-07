/**
 * Lightweight JWT implementation using Web Crypto API (Edge-compatible).
 * Only supports HS256.
 */

function getSecret(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) throw new Error("JWT_SECRET environment variable is required.");
  if (s.length < 8) {
    throw new Error(
      "JWT_SECRET must be at least 8 characters (use 32+ in production).",
    );
  }
  return s;
}

function getExpiresInSeconds(): number {
  const raw = process.env.JWT_EXPIRES_SECONDS?.trim();
  if (!raw) return 7 * 24 * 3600;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 300) {
    return 7 * 24 * 3600;
  }
  return Math.min(n, 30 * 24 * 3600);
}

function base64url(buf: ArrayBuffer): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlEncode(str: string): string {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str: string): string {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf-8",
  );
}

async function hmacSign(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64url(sig);
}

export interface JwtPayload {
  sub: string;
  role: string;
  name?: string;
  iat: number;
  exp: number;
}

export async function signJwt(
  payload: Omit<JwtPayload, "iat" | "exp">,
  expiresInSeconds = getExpiresInSeconds(),
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64urlEncode(JSON.stringify(fullPayload));
  const sig = await hmacSign(`${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const expectedSig = await hmacSign(`${header}.${body}`);

  if (sig.length !== expectedSig.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) {
    mismatch |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  try {
    const payload = JSON.parse(base64urlDecode(body)) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
