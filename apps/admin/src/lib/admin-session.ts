import type { NextRequest } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/admin-auth";

export const ADMIN_SESSION_COOKIE = "audit_admin_session";
export const LEGACY_ADMIN_COOKIES = [
  "audit_role",
  "audit_leader_kind",
  "audit_login_phone",
] as const;
export const ADMIN_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type AdminSessionRole = "leader" | "supervisor";
export type AdminLeaderSessionKind = "primary" | "env" | "delegated" | "none";

export interface AdminSessionPayload {
  v: 2;
  sub: string;
  role: AdminSessionRole;
  leaderKind: AdminLeaderSessionKind;
  phone: string;
  name: string;
  iat: number;
  exp: number;
}

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("缺少 ADMIN_SESSION_SECRET，后台会话已拒绝启动。");
  }
  if (secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET 至少需要 32 位字符。");
  }
  return secret;
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

function isAdminSessionPayload(value: unknown): value is AdminSessionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<AdminSessionPayload>;
  return (
    payload.v === 2 &&
    (payload.role === "leader" || payload.role === "supervisor") &&
    (payload.leaderKind === "primary" ||
      payload.leaderKind === "env" ||
      payload.leaderKind === "delegated" ||
      payload.leaderKind === "none") &&
    typeof payload.sub === "string" &&
    typeof payload.phone === "string" &&
    typeof payload.name === "string" &&
    typeof payload.iat === "number" &&
    typeof payload.exp === "number"
  );
}

export function getAdminSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  };
}

export async function signAdminSessionValue(
  payload: Omit<AdminSessionPayload, "v" | "iat" | "exp">,
) {
  const secret = getSessionSecret();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionPayload: AdminSessionPayload = {
    ...payload,
    v: 2,
    iat: nowSeconds,
    exp: nowSeconds + ADMIN_SESSION_MAX_AGE_SECONDS,
  };
  const rawPayload = JSON.stringify(sessionPayload);
  const sig = await hmacSha256Hex(secret, rawPayload);
  return `${Buffer.from(rawPayload).toString("base64url")}.${sig}`;
}

export async function readAdminSessionCookieValue(
  value?: string | null,
): Promise<AdminSessionPayload | null> {
  if (!value) {
    return null;
  }

  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return null;
  }

  const dot = value.indexOf(".");
  if (dot === -1) {
    return null;
  }

  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);

  let rawPayload: string;
  try {
    rawPayload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expectedSig = await hmacSha256Hex(secret, rawPayload);
  if (!timingSafeEqualHex(sig, expectedSig)) {
    return null;
  }

  try {
    const data = JSON.parse(rawPayload);
    if (!isAdminSessionPayload(data)) {
      return null;
    }
    return data.exp > Math.floor(Date.now() / 1000) ? data : null;
  } catch {
    return null;
  }
}

export async function verifyAdminSessionCookieValue(value?: string | null) {
  return Boolean(await readAdminSessionCookieValue(value));
}

export async function getAdminSessionFromCookies(cookieStore: CookieReader) {
  return readAdminSessionCookieValue(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
}

export async function getAdminSessionFromRequest(request: NextRequest) {
  return getAdminSessionFromCookies(request.cookies);
}

export function isLeaderAdminSession(session: AdminSessionPayload | null) {
  return session?.role === "leader";
}

export function isPrimaryLeaderSession(session: AdminSessionPayload | null) {
  return session?.role === "leader" && session.leaderKind === "primary";
}

export async function getAdminRequestContext(request: NextRequest) {
  if (isAuthorizedAdminRequest(request.headers).ok) {
    return {
      authorized: true,
      source: "basic" as const,
      session: null,
      isLeader: true,
      isPrimaryLeader: true,
    };
  }

  const session = await getAdminSessionFromRequest(request);
  return {
    authorized: Boolean(session),
    source: session ? ("session" as const) : ("none" as const),
    session,
    isLeader: isLeaderAdminSession(session),
    isPrimaryLeader: isPrimaryLeaderSession(session),
  };
}

export async function verifyAdminSessionFromRequest(request: NextRequest) {
  return Boolean(await getAdminSessionFromRequest(request));
}

export async function isAdminSessionOrBasicAuthorized(
  request: NextRequest,
): Promise<boolean> {
  return (await getAdminRequestContext(request)).authorized;
}
