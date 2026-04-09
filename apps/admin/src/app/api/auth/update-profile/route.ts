import { NextResponse, type NextRequest } from "next/server";
import { verifyJwt, signJwt } from "@/lib/jwt";
import { getUserByOpenid, updateUser } from "@/lib/user-store";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "auth-update-profile", 20);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, message: "请求过于频繁" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const auth = request.headers.get("authorization")?.trim();
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, message: "未登录" }, { status: 401 });
  }

  const payload = await verifyJwt(auth.slice(7));
  if (!payload?.sub) {
    return NextResponse.json({ ok: false, message: "登录已过期" }, { status: 401 });
  }

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "请求格式错误" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name || name.length > 20) {
    return NextResponse.json(
      { ok: false, message: "姓名不能为空且不超过20字" },
      { status: 400 },
    );
  }

  const user = await getUserByOpenid(payload.sub);
  if (!user) {
    return NextResponse.json({ ok: false, message: "用户不存在" }, { status: 404 });
  }

  await updateUser(payload.sub, { name });

  const newToken = await signJwt({
    sub: user.openid,
    role: user.role,
    name,
  });

  return NextResponse.json({
    ok: true,
    token: newToken,
    user: {
      openid: user.openid,
      role: user.role,
      name,
      phone: user.phone,
      status: user.status,
    },
  });
}
