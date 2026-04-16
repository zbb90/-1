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

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-wide text-gray-500">
                Review Tasks
              </p>
              <h2 className="mt-1 text-lg font-semibold text-gray-900">复核数据源</h2>
            </div>
            <form action={repairReviewStorageAction}>
              <input type="hidden" name="source" value="redis" />
              <button
                type="submit"
                className="rounded-xl bg-green-700 px-4 py-2 text-sm font-medium text-white"
              >
                重建 Redis 索引
              </button>
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
              `redis-only` 表示线上只信任 Redis；若 Redis 任务主键数大于 0 但索引数等于
              0，说明主数据还在但索引坏了，应优先点“重建 Redis 索引”。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={repairReviewStorageAction}>
                <input type="hidden" name="source" value="file" />
                <button
                  type="submit"
                  className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                >
                  从本地 review 文件补回
                </button>
              </form>
              <form action={repairReviewStorageAction}>
                <input type="hidden" name="source" value="legacy" />
                <button
                  type="submit"
                  className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                >
                  从 legacy 列表补回
                </button>
              </form>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              上面两个“补回”动作只做增量合并，不会删除现有 Redis 主键。
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-wide text-gray-500">
                User Store
              </p>
              <h2 className="mt-1 text-lg font-semibold text-gray-900">账号索引</h2>
            </div>
            <form action={repairUserIndexesAction}>
              <button
                type="submit"
                className="rounded-xl bg-green-700 px-4 py-2 text-sm font-medium text-white"
              >
                重建账号索引
              </button>
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
        </div>
      </section>

      <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-gray-500">
              Knowledge Base
            </p>
            <h2 className="mt-1 text-lg font-semibold text-gray-900">知识库恢复</h2>
          </div>
          <form action={restoreKnowledgeFromCsvAction}>
            <button
              type="submit"
              className="rounded-xl bg-green-700 px-4 py-2 text-sm font-medium text-white"
            >
              从 CSV 恢复到 Redis
            </button>
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
        </div>
      </section>
    </AdminShell>
  );
}
