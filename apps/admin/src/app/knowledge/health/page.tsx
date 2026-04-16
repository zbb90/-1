import Link from "next/link";
import { cookies } from "next/headers";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { getKnowledgeHealthReport } from "@/lib/knowledge-health";

function HealthPanel({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: Array<{
    ruleId: string;
    clauseNo: string;
    clauseTitle: string;
    hitCount: number;
    lastHitAt: string;
    linkCount: number;
  }>;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">暂无条目。</p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div
              key={`${title}-${item.ruleId}`}
              className="rounded-xl bg-gray-50 px-4 py-3"
            >
              <p className="text-sm font-medium text-gray-900">
                {item.ruleId}｜{item.clauseTitle || "-"}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                条款号 {item.clauseNo || "-"} · 命中 {item.hitCount} 次 · 关联{" "}
                {item.linkCount} 条
              </p>
              {item.lastHitAt ? (
                <p className="mt-1 text-xs text-gray-400">最近命中：{item.lastHitAt}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function KnowledgeHealthPage() {
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  const isLeader = session?.role === "leader";
  const report = await getKnowledgeHealthReport();

  return (
    <AdminShell>
      <AdminPageHeader
        eyebrow="知识健康度"
        title="知识库健康仪表盘"
        description={
          <>
            结合现有规则、共识引用、知识关联和复核命中记录，评估知识库是否完整、活跃、可维护。
            <br />
            该页面只做只读分析，不会修改任何知识表内容。
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
              className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
            >
              查看图谱
            </Link>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs font-medium text-gray-500">规则总数</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {report.summary.totalRules}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs font-medium text-gray-500">共识覆盖</p>
          <p className="mt-2 text-3xl font-bold text-green-700">
            {report.summary.consensusCoveragePct}%
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {report.summary.rulesWithConsensus}/{report.summary.totalRules}{" "}
            条规则已绑定共识
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs font-medium text-gray-500">关联覆盖</p>
          <p className="mt-2 text-3xl font-bold text-blue-700">
            {report.summary.linkCoveragePct}%
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {report.summary.linkedRules}/{report.summary.totalRules}{" "}
            条规则已进入知识网络
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs font-medium text-gray-500">近 30 天活跃规则</p>
          <p className="mt-2 text-3xl font-bold text-emerald-700">
            {report.summary.activeRules30dPct}%
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {report.summary.activeRules30d} 条规则近 30 天被命中
          </p>
        </div>
        <div className="rounded-2xl bg-red-50 p-5 shadow-sm ring-1 ring-red-200">
          <p className="text-xs font-medium text-red-700">风险条目</p>
          <p className="mt-2 text-3xl font-bold text-red-800">
            {report.summary.orphanRules + report.summary.coldRules}
          </p>
          <p className="mt-1 text-xs text-red-600">
            孤立 {report.summary.orphanRules} 条，冷规则 {report.summary.coldRules} 条
          </p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <HealthPanel
          title="高频命中规则 Top10"
          description="优先关注这些规则的解释质量和主管口径是否稳定。"
          items={report.topHitRules}
        />
        <HealthPanel
          title="高频但缺少共识支撑"
          description="命中多却没有共识来源，优先补判定依据。"
          items={report.highTrafficWithoutConsensus}
        />
        <HealthPanel
          title="孤立规则"
          description="没有链接也没有共识来源，通常意味着知识沉淀不足。"
          items={report.orphanRules}
        />
        <HealthPanel
          title="长期未命中规则"
          description="可能已经过时，或触发条件需要重写。"
          items={report.coldRules}
        />
      </section>
    </AdminShell>
  );
}
