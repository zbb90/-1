import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  LEGACY_ADMIN_COOKIES,
  getAdminSessionCookieOptions,
  signAdminSessionValue,
} from "@/lib/admin-session";
import { formatZodError, readJsonBody } from "@/lib/api-utils";
import { pcLoginBodySchema } from "@/lib/schemas";
import { rateLimit } from "@/lib/rate-limit";
import { getAdminCredentials } from "@/lib/admin-auth";
import { resolvePcLogin } from "@/lib/user-store";

/**
 * POST /api/auth/pc-login
 *
 * Body: { phone: string; password: string }
 */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "auth-pc-login", 30);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "登录尝试过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  const parsed = pcLoginBodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const { phone, password } = parsed.data;

  let login = await resolvePcLogin(phone, password);

  if (!login.ok) {
    const creds = getAdminCredentials();
    if (creds.isConfigured && phone === creds.username && password === creds.password) {
      login = {
        ok: true,
        role: "leader",
        leaderSessionKind: "primary",
        name: "负责人",
      };
    }
  }

  if (!login.ok) {
    return NextResponse.json({ error: "手机号或密码不正确" }, { status: 401 });
  }

  const leaderKind = login.role === "leader" ? login.leaderSessionKind : "none";

  const sessionValue = await signAdminSessionValue({
    sub: login.role === "leader" ? `pc-leader:${phone}` : `pc-supervisor:${phone}`,
    role: login.role,
    leaderKind,
    phone,
    name: login.name,
  });

  const response = NextResponse.json({
    ok: true,
    role: login.role,
    name: login.role === "leader" ? login.name : login.name,
    leaderKind,
  });
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    sessionValue,
    getAdminSessionCookieOptions(),
  );
  for (const legacyName of LEGACY_ADMIN_COOKIES) {
    response.cookies.delete(legacyName);
  }

  return response;
}
