import { NextResponse, type NextRequest } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { getUserByOpenid, updateUser, isPrimaryLeaderPhone } from "@/lib/user-store";

function isLeaderRole(request: NextRequest): boolean {
  return request.cookies.get("audit_role")?.value === "leader";
}

/**
 * PATCH /api/users/:id — update user (leader only)
 *
 * Body: { status?: "active" | "disabled"; name?: string; role?: "supervisor" | "specialist" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSessionOrBasicAuthorized(request)) || !isLeaderRole(request)) {
    return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
  }

  const { id } = await params;
  const openid = decodeURIComponent(id);
  const body = await request.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "缺少更新数据" }, { status: 400 });
  }

  const user = await getUserByOpenid(openid);
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  if (user.role === "leader" && user.leaderKind === "delegated") {
    const loginPhone = request.cookies.get("audit_login_phone")?.value?.trim();
    if (!loginPhone || !isPrimaryLeaderPhone(loginPhone)) {
      return NextResponse.json(
        { error: "仅主负责人可启用/停用副负责人" },
        { status: 403 },
      );
    }
  }

  const patch: Record<string, string> = {};
  if (body.status === "active" || body.status === "disabled")
    patch.status = body.status;
  if (body.name?.trim()) patch.name = body.name.trim();
  if (typeof body.password === "string" && body.password.trim()) {
    patch.password = body.password.trim();
  }

  const updated = await updateUser(openid, patch);
  return NextResponse.json({ user: updated });
}

/**
 * DELETE /api/users/:id — disable user (leader only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSessionOrBasicAuthorized(request)) || !isLeaderRole(request)) {
    return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
  }

  const { id } = await params;
  const openid = decodeURIComponent(id);

  const user = await getUserByOpenid(openid);
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  if (user.role === "leader" && user.leaderKind === "delegated") {
    const loginPhone = request.cookies.get("audit_login_phone")?.value?.trim();
    if (!loginPhone || !isPrimaryLeaderPhone(loginPhone)) {
      return NextResponse.json({ error: "仅主负责人可停用副负责人" }, { status: 403 });
    }
  }

  const updated = await updateUser(openid, { status: "disabled" });
  if (!updated) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, user: updated });
}
