import Link from "next/link";
import { cookies } from "next/headers";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { AuditMatchWorkbench } from "./audit-match-workbench";

export default async function AuditMatchPage() {
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  const isLeader = session?.role === "leader";

  return (
    <AdminShell maxWidthClass="max-w-screen-2xl">
      <AdminPageHeader
        eyebrow="AI 分析工具"
        title="稽核表匹配共识"
        description={
          <>
            上传稽核表与共识表
            Excel，系统会先做候选召回，再结合语义匹配与模型判定输出可解释结果。
            <br />
            第一版只导出分析和知识沉淀草稿，不会直接写入正式知识库。
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
              href="/knowledge"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              返回知识库
            </Link>
            <Link
              href="/knowledge/graph"
              className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              查看知识图谱
            </Link>
          </div>
        }
      />

      <AuditMatchWorkbench />
    </AdminShell>
  );
}
