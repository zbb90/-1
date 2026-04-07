import { NextResponse, type NextRequest } from "next/server";
import { signAdminSessionValue, ADMIN_SESSION_COOKIE } from "@/lib/admin-session";
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

  const body = await request.json().catch(() => null);
  const phone = body?.phone?.trim();
  const password = body?.password;

  if (!phone || !password) {
    return NextResponse.json({ error: "请输入手机号和密码" }, { status: 400 });
  }

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

  const leaderKindCookie = login.role === "leader" ? login.leaderSessionKind : "none";

  const sessionValue = await signAdminSessionValue();

  const response = NextResponse.json({
    ok: true,
    role: login.role,
    name: login.role === "leader" ? login.name : login.name,
    leaderKind: leaderKindCookie,
  });
  response.cookies.set(ADMIN_SESSION_COOKIE, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  response.cookies.set("audit_role", login.role, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  response.cookies.set("audit_leader_kind", leaderKindCookie, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  response.cookies.set("audit_login_phone", phone, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
}
