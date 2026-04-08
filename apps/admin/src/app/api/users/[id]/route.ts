import { NextResponse, type NextRequest } from "next/server";
import { getAdminRequestContext } from "@/lib/admin-session";
import { formatZodError, readJsonBody } from "@/lib/api-utils";
import { hashPassword } from "@/lib/password";
import { userUpdateBodySchema } from "@/lib/schemas";
import {
  getUserByOpenid,
  toPublicUser,
  updateUser,
  type AppUser,
} from "@/lib/user-store";

/**
 * PATCH /api/users/:id — update user (leader only)
 *
 * Body: { status?: "active" | "disabled"; name?: string; role?: "supervisor" | "specialist" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminRequestContext(request);
  if (!admin.authorized || !admin.isLeader) {
    return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
  }

  const { id } = await params;
  const openid = decodeURIComponent(id);
  const parsed = userUpdateBodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

  const user = await getUserByOpenid(openid);
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  if (user.role === "leader" && user.leaderKind === "delegated") {
    if (!admin.isPrimaryLeader) {
      return NextResponse.json(
        { error: "仅主负责人可启用/停用副负责人" },
        { status: 403 },
      );
    }
  }

  const patch: Partial<Omit<AppUser, "openid">> = {};
  if (body.status === "active" || body.status === "disabled")
    patch.status = body.status;
  if (body.name?.trim()) patch.name = body.name.trim();
  if (typeof body.password === "string" && body.password.trim()) {
    patch.passwordHash = await hashPassword(body.password.trim());
    patch.password = undefined;
  }

  const updated = await updateUser(openid, patch);
  return NextResponse.json({ user: updated ? toPublicUser(updated) : null });
}

/**
 * DELETE /api/users/:id — disable user (leader only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminRequestContext(request);
  if (!admin.authorized || !admin.isLeader) {
    return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
  }

  const { id } = await params;
  const openid = decodeURIComponent(id);

  const user = await getUserByOpenid(openid);
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  if (user.role === "leader" && user.leaderKind === "delegated") {
    if (!admin.isPrimaryLeader) {
      return NextResponse.json({ error: "仅主负责人可停用副负责人" }, { status: 403 });
    }
  }

  const updated = await updateUser(openid, { status: "disabled" });
  if (!updated) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, user: toPublicUser(updated) });
}
