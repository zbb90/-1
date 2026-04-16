import { cookies } from "next/headers";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import { KnowledgeTabs } from "./knowledge-tabs";

export default async function KnowledgePage() {
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  const isLeader = session?.role === "leader";

  return (
    <AdminShell>
      <AdminPageHeader
        eyebrow="知识库管理"
        title="稽核知识库"
        description={
          <>
            管理五张知识表：常规问题规则、共识解释、外购清单、旧品清单、操作知识。
            <br />
            支持在线新增、编辑、停用/启用、Excel 批量导入和导出。
          </>
        }
        actions={
          <AdminNav
            current="knowledge"
            showUsersLink={isLeader}
            showStorageLink={isLeader}
          />
        }
      />

      <KnowledgeTabs />
    </AdminShell>
  );
}
