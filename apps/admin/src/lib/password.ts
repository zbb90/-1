import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;

function encodeBase64Url(buffer: Uint8Array) {
  return Buffer.from(buffer).toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

export function isPasswordHash(value?: string | null) {
  return typeof value === "string" && value.startsWith(`${HASH_PREFIX}$`);
}

export function validatePasswordStrength(password: string) {
  const normalized = password.trim();
  if (normalized.length < 8) {
    return "密码至少需要 8 位字符。";
  }
  return null;
}

export function generateTemporaryPassword(length = 12) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH);
  return [
    HASH_PREFIX,
    encodeBase64Url(salt),
    encodeBase64Url(new Uint8Array(derived)),
  ].join("$");
}

export async function verifyPassword(password: string, storedHash: string) {
  if (!isPasswordHash(storedHash)) {
    return false;
  }

  const [, saltB64, hashB64] = storedHash.split("$");
  if (!saltB64 || !hashB64) {
    return false;
  }

  const salt = decodeBase64Url(saltB64);
  const expected = decodeBase64Url(hashB64);
  const actual = scryptSync(password, salt, expected.length);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
