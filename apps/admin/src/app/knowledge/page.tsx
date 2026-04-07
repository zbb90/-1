import { cookies } from "next/headers";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import { KnowledgeTabs } from "./knowledge-tabs";

export default async function KnowledgePage() {
  const cookieStore = await cookies();
  const isLeader = cookieStore.get("audit_role")?.value === "leader";

  return (
    <AdminShell>
      <AdminPageHeader
        eyebrow="知识库管理"
        title="稽核知识库"
        description={
          <>
            管理四张知识表：常规问题规则、共识解释、外购清单、旧品清单。
            <br />
            支持在线新增、编辑、停用/启用、Excel 批量导入和导出。
          </>
        }
        actions={<AdminNav current="knowledge" showUsersLink={isLeader} />}
      />

      <KnowledgeTabs />
    </AdminShell>
  );
}
