import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { getKnowledgeStorageDiagnostics } from "@/lib/knowledge-store";
import { getReviewStorageDiagnostics } from "@/lib/review-pool";
import { getUserStorageDiagnostics } from "@/lib/user-store";
import {
  WorkspaceActionButton,
  WorkspaceMetric,
  WorkspaceSection,
} from "@/components/admin/knowledge-workspace";
import {
  rebuildKnowledgeVectorIndexAction,
  repairReviewStorageAction,
  repairUserIndexesAction,
  restoreKnowledgeFromCsvAction,
} from "./actions";

function StatCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  tone?: "slate" | "green" | "amber" | "violet";
}) {
  const toneClass = {
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
    green: "bg-green-50 text-green-700 ring-green-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
  }[tone];

  return (
    <div className={`rounded-2xl px-4 py-3 ring-1 ${toneClass}`}>
      <p className="text-xs font-medium tracking-wide opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default async function StoragePage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  if (session?.role !== "leader") {
    redirect("/reviews");
  }

  const [{ message }, reviewDiagnostics, userDiagnostics, knowledgeDiagnostics] =
    await Promise.all([
      searchParams,
      getReviewStorageDiagnostics(),
      getUserStorageDiagnostics(),
      getKnowledgeStorageDiagnostics(),
    ]);

  return (
    <AdminShell>
      <AdminPageHeader
        eyebrow="运维与排障"
        title="存储诊断"
        description="统一查看复核数据与账号索引当前读写状态，并提供显式修复入口。"
        actions={<AdminNav current="storage" showUsersLink showStorageLink />}
      />

      {message ? (
        <section className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <WorkspaceMetric
          label="复核主键"
          value={reviewDiagnostics.redisTaskKeyCount}
          tone="green"
        />
        <WorkspaceMetric
          label="账号主键"
          value={userDiagnostics.userKeyCount}
          tone="blue"
        />
        <WorkspaceMetric
          label="知识库行键"
          value={knowledgeDiagnostics.redisRowKeyCount}
          tone="violet"
        />
        <WorkspaceMetric
          label="环境负责人"
          value={userDiagnostics.envLeaderCount}
          tone="amber"
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <WorkspaceSection
            title="复核数据源"
            description="左侧主体区先看主数据、索引和补回入口。"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium tracking-wide text-gray-500">
                  Review Tasks
                </p>
                <h2 className="mt-1 text-lg font-semibold text-gray-900">复核数据源</h2>
              </div>
              <form action={repairReviewStorageAction}>
                <input type="hidden" name="source" value="redis" />
                <WorkspaceActionButton type="submit" tone="green">
                  重建 Redis 索引
                </WorkspaceActionButton>
              </form>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <StatCard label="当前模式" value={reviewDiagnostics.mode} tone="green" />
              <StatCard label="本地文件任务数" value={reviewDiagnostics.fileCount} />
              <StatCard
                label="Redis 任务主键数"
                value={reviewDiagnostics.redisTaskKeyCount}
              />
              <StatCard
                label="Redis 索引数"
                value={reviewDiagnostics.redisIndexCount}
                tone="amber"
              />
              <StatCard
                label="请求人分桶数"
                value={reviewDiagnostics.redisRequesterBucketCount}
                tone="violet"
              />
              <StatCard
                label="旧版 Redis 列表数"
                value={reviewDiagnostics.legacyTaskCount}
              />
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p>判读规则：</p>
              <p className="mt-2">
                `redis-only` 表示线上只信任 Redis；若 Redis 任务主键数大于 0
                但索引数等于 0，说明主数据还在但索引坏了，应优先点“重建 Redis 索引”。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={repairReviewStorageAction}>
                  <input type="hidden" name="source" value="file" />
                  <WorkspaceActionButton type="submit" tone="slate" outline>
                    从本地 review 文件补回
                  </WorkspaceActionButton>
                </form>
                <form action={repairReviewStorageAction}>
                  <input type="hidden" name="source" value="legacy" />
                  <WorkspaceActionButton type="submit" tone="slate" outline>
                    从 legacy 列表补回
                  </WorkspaceActionButton>
                </form>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                上面两个“补回”动作只做增量合并，不会删除现有 Redis 主键。
              </p>
            </div>
          </WorkspaceSection>

          <WorkspaceSection
            title="账号索引"
            description="账号页是否能正常展示，通常先看这里。"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium tracking-wide text-gray-500">
                  User Store
                </p>
                <h2 className="mt-1 text-lg font-semibold text-gray-900">账号索引</h2>
              </div>
              <form action={repairUserIndexesAction}>
                <WorkspaceActionButton type="submit" tone="green">
                  重建账号索引
                </WorkspaceActionButton>
              </form>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Redis 已配置"
                value={userDiagnostics.redisConfigured ? "是" : "否"}
              />
              <StatCard
                label="用户主键数"
                value={userDiagnostics.userKeyCount}
                tone="green"
              />
              <StatCard
                label="手机号索引数"
                value={userDiagnostics.phoneIndexCount}
                tone="amber"
              />
              <StatCard
                label="负责人集合数"
                value={userDiagnostics.roleSetCounts.leader}
              />
              <StatCard
                label="主管集合数"
                value={userDiagnostics.roleSetCounts.supervisor}
                tone="violet"
              />
              <StatCard
                label="专员集合数"
                value={userDiagnostics.roleSetCounts.specialist}
              />
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p>环境负责人账号数：{userDiagnostics.envLeaderCount}</p>
              <p className="mt-2">
                如果“账号管理”页面为空，常见原因是 Redis
                里的手机号索引或角色集合缺失，而不是用户主数据本身丢失。
              </p>
            </div>
          </WorkspaceSection>

          <WorkspaceSection
            title="知识库恢复"
            description="知识库恢复主体和其他运维主体放在同一列。"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium tracking-wide text-gray-500">
                  Knowledge Base
                </p>
                <h2 className="mt-1 text-lg font-semibold text-gray-900">知识库恢复</h2>
              </div>
              <form action={restoreKnowledgeFromCsvAction}>
                <WorkspaceActionButton type="submit" tone="green">
                  从 CSV 恢复到 Redis
                </WorkspaceActionButton>
              </form>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard
                label="Redis 行键数"
                value={knowledgeDiagnostics.redisRowKeyCount}
                tone="green"
              />
              <StatCard
                label="规则表 Redis 行数"
                value={knowledgeDiagnostics.redisCounts.rules}
              />
              <StatCard
                label="规则表 CSV 行数"
                value={knowledgeDiagnostics.csvCounts.rules}
              />
              <StatCard
                label="共识表 Redis 行数"
                value={knowledgeDiagnostics.redisCounts.consensus}
                tone="amber"
              />
              <StatCard
                label="外购表 Redis 行数"
                value={knowledgeDiagnostics.redisCounts["external-purchases"]}
              />
              <StatCard
                label="旧品表 Redis 行数"
                value={knowledgeDiagnostics.redisCounts["old-items"]}
                tone="violet"
              />
              <StatCard
                label="操作表 Redis 行数"
                value={knowledgeDiagnostics.redisCounts.operations}
              />
              <StatCard
                label="外购表 CSV 行数"
                value={knowledgeDiagnostics.csvCounts["external-purchases"]}
              />
              <StatCard
                label="旧品表 CSV 行数"
                value={knowledgeDiagnostics.csvCounts["old-items"]}
              />
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p>
                当前知识库的基础恢复源是服务器上的
                `data/templates/*.csv`。恢复动作会把五张表写回
                Redis，并尝试重建规则向量索引。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={rebuildKnowledgeVectorIndexAction}>
                  <WorkspaceActionButton type="submit" tone="violet">
                    重建知识向量库（规则 + 共识 + FAQ）
                  </WorkspaceActionButton>
                </form>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                B
                档三源召回必须基于此动作重建一次：清空当前向量集合，重新对所有启用的规则、共识和
                FAQ 做 embedding 并写入 Qdrant。会消耗 DashScope 配额，单店知识库通常 1
                分钟内完成。
              </p>
            </div>
          </WorkspaceSection>
        </div>

        <div className="space-y-5">
          <WorkspaceSection
            title="修复动作"
            description="把高频修复入口放到右侧工具区，和知识库页保持相同使用习惯。"
          >
            <div className="flex flex-col gap-3">
              <form action={repairReviewStorageAction}>
                <input type="hidden" name="source" value="redis" />
                <WorkspaceActionButton
                  type="submit"
                  tone="green"
                  className="w-full justify-center"
                >
                  重建复核 Redis 索引
                </WorkspaceActionButton>
              </form>
              <form action={repairUserIndexesAction}>
                <WorkspaceActionButton
                  type="submit"
                  tone="blue"
                  className="w-full justify-center"
                >
                  重建账号索引
                </WorkspaceActionButton>
              </form>
              <form action={restoreKnowledgeFromCsvAction}>
                <WorkspaceActionButton
                  type="submit"
                  tone="violet"
                  className="w-full justify-center"
                >
                  恢复知识库到 Redis
                </WorkspaceActionButton>
              </form>
              <form action={rebuildKnowledgeVectorIndexAction}>
                <WorkspaceActionButton
                  type="submit"
                  tone="amber"
                  className="w-full justify-center"
                >
                  重建知识向量库
                </WorkspaceActionButton>
              </form>
            </div>
          </WorkspaceSection>

          <WorkspaceSection
            title="判读说明"
            description="右侧承接运维判断逻辑，而不是把说明散在主体区。"
          >
            <div className="space-y-3 text-sm leading-6 text-slate-600">
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                `redis-only` 表示线上只信任 Redis；若 Redis 任务主键数大于 0
                但索引数等于 0，说明主数据还在但索引坏了，应先重建索引。
              </div>
              <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
                “补回”动作只做增量合并，不会删除现有 Redis
                主键，适合缺索引或缺部分副本时使用。
              </div>
              <div className="rounded-2xl bg-blue-50 p-4 ring-1 ring-blue-200">
                如果账号管理页异常但 Redis
                用户主键仍存在，优先检查手机号索引和角色集合，而不是直接判断账号丢失。
              </div>
            </div>
          </WorkspaceSection>
        </div>
      </div>
    </AdminShell>
  );
}
