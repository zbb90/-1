import { NextResponse, type NextRequest } from "next/server";
import { formatZodError, logRouteError, readJsonBody } from "@/lib/api-utils";
import { signJwt } from "@/lib/jwt";
import { rateLimit } from "@/lib/rate-limit";
import { wxLoginBodySchema } from "@/lib/schemas";
import { getUserByOpenid, createUser, type AppUser } from "@/lib/user-store";

/**
 * POST /api/auth/wx-login
 *
 * Body: { code: string; name?: string; phone?: string }
 *
 * Flow:
 *   1. Exchange code for openid via WeChat jscode2session
 *   2. Find or auto-register user as specialist
 *   3. Return JWT token + user info
 */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "auth-wx-login", 60);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  const parsed = wxLoginBodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

  const appId = process.env.WX_APPID?.trim();
  const appSecret = process.env.WX_APP_SECRET?.trim();

  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: "服务器未配置微信小程序 appId / appSecret" },
      { status: 500 },
    );
  }

  const wxUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${body.code}&grant_type=authorization_code`;

  let openid: string;
  try {
    const wxRes = await fetch(wxUrl);
    const wxData = (await wxRes.json()) as {
      openid?: string;
      session_key?: string;
      errcode?: number;
      errmsg?: string;
    };

    if (!wxData.openid) {
      return NextResponse.json(
        { error: `微信登录失败: ${wxData.errmsg || "未知错误"}` },
        { status: 401 },
      );
    }
    openid = wxData.openid;
  } catch (err) {
    logRouteError("/api/auth/wx-login", err);
    return NextResponse.json(
      { error: "微信登录服务暂时不可用，请稍后重试。" },
      { status: 502 },
    );
  }

  let user = await getUserByOpenid(openid);

  if (!user) {
    const now = new Date().toISOString();
    const newUser: AppUser = {
      openid,
      role: "specialist",
      name: body.name?.trim() || "专员",
      phone: body.phone?.trim() || "",
      status: "active",
      createdAt: now,
      createdBy: "wx-auto-register",
    };
    user = await createUser(newUser);
  }

  if (user.status === "disabled") {
    return NextResponse.json({ error: "账号已被停用，请联系负责人" }, { status: 403 });
  }

  const token = await signJwt({
    sub: user.openid,
    role: user.role,
    name: user.name,
  });

  return NextResponse.json({
    token,
    user: {
      openid: user.openid,
      role: user.role,
      name: user.name,
      phone: user.phone,
      status: user.status,
    },
  });
}
