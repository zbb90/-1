const ADMIN_USER_ENV = "ADMIN_BASIC_AUTH_USER";
const ADMIN_PASSWORD_ENV = "ADMIN_BASIC_AUTH_PASSWORD";

const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_PASSWORD = "audit2026";

function decodeBase64(value: string) {
  if (typeof atob === "function") {
    return atob(value);
  }

  return Buffer.from(value, "base64").toString("utf-8");
}

export function getAdminCredentials() {
  const username = process.env[ADMIN_USER_ENV]?.trim() || DEFAULT_ADMIN_USER;
  const password =
    process.env[ADMIN_PASSWORD_ENV]?.trim() || DEFAULT_ADMIN_PASSWORD;

  return {
    username,
    password,
    isConfigured: true,
    usingDefaults:
      !process.env[ADMIN_USER_ENV] || !process.env[ADMIN_PASSWORD_ENV],
  };
}

export function isAuthorizedAdminRequest(headers: Headers) {
  const { username, password, isConfigured } = getAdminCredentials();
  if (!isConfigured) {
    return {
      ok: false,
      reason: `未配置后台鉴权，请设置 ${ADMIN_USER_ENV} 和 ${ADMIN_PASSWORD_ENV}。`,
    };
  }

  const authorization = headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Basic ")) {
    return {
      ok: false,
      reason: "后台处理接口需要管理员身份验证。",
    };
  }

  try {
    const encoded = authorization.slice("Basic ".length);
    const decoded = decodeBase64(encoded);
    const [actualUsername, ...passwordParts] = decoded.split(":");
    const actualPassword = passwordParts.join(":");

    if (actualUsername === username && actualPassword === password) {
      return { ok: true as const };
    }
  } catch {
    return {
      ok: false,
      reason: "后台身份验证信息解析失败。",
    };
  }

  return {
    ok: false,
    reason: "后台账号或密码不正确。",
  };
}
