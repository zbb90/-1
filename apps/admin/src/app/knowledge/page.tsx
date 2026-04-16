import { cookies } from "next/headers";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import { KnowledgeTabs } from "./knowledge-tabs";
import Link from "next/link";

export default async function KnowledgePage() {
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  const isLeader = session?.role === "leader";

  return (
    <AdminShell maxWidthClass="max-w-screen-2xl">
      <AdminPageHeader
        eyebrow="知识库管理"
        title="稽核知识库"
        description={
          <>
            管理五张知识表：常规问题规则、共识解释、外购清单、旧品清单、操作知识。
            <br />
            支持在线新增、编辑、停用/启用、Excel 批量导入导出，以及只读的知识健康分析。
          </>
        }
        actions={
          <AdminNav
            current="knowledge"
            showUsersLink={isLeader}
            showStorageLink={isLeader}
          />
        }
        footer={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/knowledge/health"
              className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
            >
              知识健康度
            </Link>
            <Link
              href="/knowledge/graph"
              className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              知识图谱
            </Link>
            <Link
              href="/knowledge/audit-match"
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
            >
              稽核共识匹配
            </Link>
          </div>
        }
      />

      <KnowledgeTabs />
    </AdminShell>
  );
}
