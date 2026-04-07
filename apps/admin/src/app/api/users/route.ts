import { NextResponse, type NextRequest } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import {
  listAllUsers,
  createUser,
  getUserByPhone,
  isPrimaryLeaderPhone,
  type AppUser,
} from "@/lib/user-store";

function isLeaderRole(request: NextRequest): boolean {
  return request.cookies.get("audit_role")?.value === "leader";
}

/**
 * GET /api/users — list all users (leader only)
 */
export async function GET(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request)) || !isLeaderRole(request)) {
    return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
  }

  const users = await listAllUsers();
  return NextResponse.json({ users });
}

/**
 * POST /api/users
 *
 * Body:
 *   { name, phone, type?: "supervisor" | "delegated_leader" }
 *   默认 type=supervisor。副负责人仅主负责人（audit_leader_kind=primary）可创建。
 */
export async function POST(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request)) || !isLeaderRole(request)) {
    return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const name = body?.name?.trim();
  const phone = body?.phone?.trim();
  const type = body?.type === "delegated_leader" ? "delegated_leader" : "supervisor";

  if (!name || !phone) {
    return NextResponse.json({ error: "请填写姓名和手机号" }, { status: 400 });
  }

  if (type === "delegated_leader") {
    const loginPhone = request.cookies.get("audit_login_phone")?.value?.trim();
    if (!loginPhone || !isPrimaryLeaderPhone(loginPhone)) {
      return NextResponse.json(
        { error: "仅主负责人可为组织添加副负责人（请使用主账号手机号登录）" },
        { status: 403 },
      );
    }
  }

  const existing = await getUserByPhone(phone);
  if (existing) {
    return NextResponse.json({ error: "该手机号已注册" }, { status: 409 });
  }

  const now = new Date().toISOString();

  if (type === "delegated_leader") {
    const user: AppUser = {
      openid: `pc-leader-${phone}`,
      role: "leader",
      leaderKind: "delegated",
      name,
      phone,
      status: "active",
      createdAt: now,
      createdBy: "primary-leader",
    };
    await createUser(user);
    return NextResponse.json({ user }, { status: 201 });
  }

  const user: AppUser = {
    openid: `pc-${phone}`,
    role: "supervisor",
    name,
    phone,
    status: "active",
    createdAt: now,
    createdBy: "leader",
  };

  await createUser(user);
  return NextResponse.json({ user }, { status: 201 });
}
