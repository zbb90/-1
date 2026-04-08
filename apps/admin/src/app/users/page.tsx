import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getAdminSessionFromCookies,
  isPrimaryLeaderSession,
} from "@/lib/admin-session";
import {
  listAllUsers,
  getEnvLeaderSummaries,
  getPrimaryLeaderPhone,
  toPublicUser,
} from "@/lib/user-store";
import { UserManagement } from "./user-management";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function UsersPage() {
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  const role = session?.role;

  if (role !== "leader") {
    redirect("/reviews");
  }

  const users = (await listAllUsers()).map(toPublicUser);
  const envSummaries = getEnvLeaderSummaries();
  const primaryPhone = getPrimaryLeaderPhone();
  const canDelegate = isPrimaryLeaderSession(session);

  return (
    <AdminShell>
      <AdminPageHeader
        eyebrow="负责人管理"
        title="账号与权限"
        description="三级角色：负责人（PC）→ 主管（PC）→ 专员（小程序微信登录）。"
        actions={<AdminNav current="users" showUsersLink />}
      />

      <UserManagement
        initialUsers={users}
        envSummaries={envSummaries}
        canDelegate={canDelegate}
        primaryPhoneHint={primaryPhone ?? ""}
      />
    </AdminShell>
  );
}
