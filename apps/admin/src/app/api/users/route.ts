import { NextResponse, type NextRequest } from "next/server";
import { getAdminRequestContext } from "@/lib/admin-session";
import { formatZodError, readJsonBody } from "@/lib/api-utils";
import { generateTemporaryPassword, hashPassword } from "@/lib/password";
import { userCreateBodySchema } from "@/lib/schemas";
import {
  listAllUsers,
  createUser,
  getUserByPhone,
  toPublicUser,
  type AppUser,
} from "@/lib/user-store";

/**
 * GET /api/users — list all users (leader only)
 */
export async function GET(request: NextRequest) {
  const admin = await getAdminRequestContext(request);
  if (!admin.authorized || !admin.isLeader) {
    return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
  }

  const users = await listAllUsers();
  return NextResponse.json({ users: users.map(toPublicUser) });
}

/**
 * POST /api/users
 *
 * Body:
 *   { name, phone, type?: "supervisor" | "delegated_leader" }
 *   默认 type=supervisor。副负责人仅主负责人可创建。
 */
export async function POST(request: NextRequest) {
  const admin = await getAdminRequestContext(request);
  if (!admin.authorized || !admin.isLeader) {
    return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
  }

  const parsed = userCreateBodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const { name, phone, type } = parsed.data;

  if (type === "delegated_leader") {
    if (!admin.isPrimaryLeader) {
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
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  if (type === "delegated_leader") {
    const user: AppUser = {
      openid: `pc-leader-${phone}`,
      role: "leader",
      leaderKind: "delegated",
      name,
      phone,
      passwordHash,
      status: "active",
      createdAt: now,
      createdBy: admin.session?.sub || "primary-leader",
    };
    await createUser(user);
    return NextResponse.json(
      { user: toPublicUser(user), temporaryPassword },
      { status: 201 },
    );
  }

  const user: AppUser = {
    openid: `pc-${phone}`,
    role: "supervisor",
    name,
    phone,
    passwordHash,
    status: "active",
    createdAt: now,
    createdBy: admin.session?.sub || "leader",
  };

  await createUser(user);
  return NextResponse.json(
    { user: toPublicUser(user), temporaryPassword },
    { status: 201 },
  );
}
