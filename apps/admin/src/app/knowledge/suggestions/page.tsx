import Link from "next/link";
import { cookies } from "next/headers";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { AiSuggestionsView } from "./suggestions-view";
import { isLinkSuggestionsEnabled } from "@/lib/link-suggester";

export const dynamic = "force-dynamic";

export default async function AiLinkSuggestionsPage() {
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  const isLeader = session?.role === "leader";
  const enabled = isLinkSuggestionsEnabled();

  return (
    <AdminShell maxWidthClass="max-w-screen-2xl">
      <AdminPageHeader
        eyebrow="AI 关联建议"
        title="知识库 AI 关联审核"
        description={
          <>
            由大模型对规则、共识、FAQ、操作知识做语义扫描，产出待审核的关联建议。
            <br />
            管理员可在这里逐条采纳、拒绝或跳过；采纳后将作为 source=ai
            的正式关联写入知识图谱。
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

      {enabled ? (
        <AiSuggestionsView />
      ) : (
        <section className="rounded-2xl bg-white p-6 text-sm leading-6 text-gray-600 shadow-sm ring-1 ring-gray-200">
          <h3 className="text-base font-semibold text-gray-900">功能未启用</h3>
          <p className="mt-2">
            AI 关联建议默认关闭。要启用，请在后台环境变量中设置
            <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5">
              KB_LINK_SUGGESTIONS_ENABLED=1
            </code>
            后重启 admin 服务，并确认 <code>DASHSCOPE_API_KEY</code>、
            <code>QDRANT_URL</code>（可选）已配置。
          </p>
          <p className="mt-2 text-gray-500">
            可选环境变量：<code>KB_LINK_MAX_PAIRS</code>（默认 200）、
            <code>KB_LINK_LLM_CONCURRENCY</code>（默认 4）、
            <code>KB_LINK_GRAPH_MIN_CONFIDENCE</code>（默认
            0.6，控制图谱中虚线的阈值）。
          </p>
        </section>
      )}
    </AdminShell>
  );
}
