import type { NextRequest } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/admin-auth";

export const ADMIN_SESSION_COOKIE = "audit_admin_session";

function getSessionSecret() {
  return (
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    process.env.ADMIN_BASIC_AUTH_PASSWORD?.trim() ||
    "audit-ai-default-session-secret-2026"
  );
}

function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return mismatch === 0;
}

async function hmacSha256Hex(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function signAdminSessionValue() {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("未配置 ADMIN_SESSION_SECRET 或 ADMIN_BASIC_AUTH_PASSWORD。");
  }

  const payload = JSON.stringify({
    v: 1,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  const sig = await hmacSha256Hex(secret, payload);
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export async function verifyAdminSessionCookieValue(
  value?: string | null,
): Promise<boolean> {
  if (!value) {
    return false;
  }

  const secret = getSessionSecret();
  if (!secret) {
    return false;
  }

  const dot = value.indexOf(".");
  if (dot === -1) {
    return false;
  }

  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return false;
  }

  const expectedSig = await hmacSha256Hex(secret, payload);
  if (!timingSafeEqualHex(sig, expectedSig)) {
    return false;
  }

  try {
    const data = JSON.parse(payload) as { exp?: number; v?: number };
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

export async function verifyAdminSessionFromRequest(request: NextRequest) {
  return verifyAdminSessionCookieValue(
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
  );
}

export async function isAdminSessionOrBasicAuthorized(
  request: NextRequest,
): Promise<boolean> {
  if (isAuthorizedAdminRequest(request.headers).ok) {
    return true;
  }

  return verifyAdminSessionFromRequest(request);
}
