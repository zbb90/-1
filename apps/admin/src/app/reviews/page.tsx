import Link from "next/link";
import { cookies } from "next/headers";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { listReviewTasks } from "@/lib/review-pool";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  StatusPill,
  WorkspaceActionLink,
  WorkspaceEmptyState,
  WorkspaceMetric,
  WorkspaceSection,
} from "@/components/admin/knowledge-workspace";

export default async function ReviewsPage() {
  let tasks: Awaited<ReturnType<typeof listReviewTasks>> = [];
  try {
    tasks = await listReviewTasks();
  } catch {
    // 复核数据异常时降级为空列表
  }
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  const isLeader = session?.role === "leader";
  const pendingCount = tasks.filter((task) => task.status === "待处理").length;
  const autoAnsweredCount = tasks.filter(
    (task) => task.status === "AI已自动回答",
  ).length;
  const completedCount = tasks.filter(
    (task) => task.status === "已处理" || task.status === "已加入知识库",
  ).length;

  return (
    <AdminShell>
      <AdminPageHeader
        eyebrow="人工复核池"
        title="复核任务列表"
        description="查看提问人、进入详情处理，并与小程序「我的复核」数据一致。"
        actions={
          <AdminNav
            current="reviews"
            showUsersLink={isLeader}
            showStorageLink={isLeader}
            extraActions={
              <WorkspaceActionLink
                href="/api/reviews/export?format=csv"
                tone="slate"
                outline
              >
                导出 CSV
              </WorkspaceActionLink>
            }
          />
        }
      />

      <section className="grid gap-4 md:grid-cols-4">
        <WorkspaceMetric label="全部任务" value={tasks.length} tone="slate" />
        <WorkspaceMetric label="待处理" value={pendingCount} tone="amber" />
        <WorkspaceMetric label="AI 已回答" value={autoAnsweredCount} tone="blue" />
        <WorkspaceMetric label="已完成" value={completedCount} tone="green" />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <WorkspaceSection
          title="复核任务"
          description="按知识库工作台结构展示任务总览、状态指标和卡片列表，而不是单纯的普通列表页。"
        >
          <div className="space-y-4">
            {tasks.length === 0 ? (
              <WorkspaceEmptyState
                title="目前还没有复核任务"
                description="后续当系统无法判断时，相关问题会自动进入人工复核池。"
              />
            ) : (
              tasks.map((task) => {
                const id = String(task?.id ?? "-");
                const type = String(task?.type ?? "-");
                const storeCode = String(task?.storeCode ?? "-");
                const status = String(task?.status ?? "-");
                const category = String(task?.category ?? "-");
                const selfJudgment = String(task?.selfJudgment ?? "-");
                const requester = String(task?.requester ?? "-");
                const description = String(task?.description ?? "-");
                const rejectReason = String(task?.rejectReason ?? "-");
                return (
                  <Link
                    key={id}
                    href={`/reviews/${id}`}
                    className="block rounded-2xl border border-gray-100 bg-slate-50/70 p-6 transition hover:border-green-200 hover:bg-green-50/50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{id}</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {type}｜门店编码：{storeCode}
                        </p>
                      </div>
                      <StatusPill
                        tone={
                          status === "待处理"
                            ? "amber"
                            : status === "已处理" || status === "已加入知识库"
                              ? "green"
                              : status === "AI已自动回答"
                                ? "blue"
                                : "slate"
                        }
                      >
                        {status}
                      </StatusPill>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-xs text-gray-500">分类</p>
                        <p className="mt-1 text-sm text-gray-800">{category}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">自行判断</p>
                        <p className="mt-1 text-sm text-gray-800">{selfJudgment}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">提问人</p>
                        <p className="mt-1 text-sm text-gray-800">{requester}</p>
                      </div>
                      <div className="md:col-span-2">
                        <p className="text-xs text-gray-500">问题描述</p>
                        <p className="mt-1 text-sm leading-6 text-gray-800">
                          {description}
                        </p>
                      </div>
                      <div className="md:col-span-2">
                        <p className="text-xs text-gray-500">系统拒答原因</p>
                        <p className="mt-1 text-sm leading-6 text-gray-800">
                          {rejectReason}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </WorkspaceSection>

        <div className="space-y-5">
          <WorkspaceSection
            title="处理说明"
            description="用右侧辅助区承接状态说明与常用动作，和知识库工作台保持同一页面层级。"
          >
            <div className="space-y-3">
              <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
                <div className="flex items-center gap-2">
                  <StatusPill tone="amber">待处理</StatusPill>
                  <p className="text-sm font-medium text-amber-900">需要主管尽快处理</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-amber-800">
                  优先进入详情页补全结论、分值、依据与回复内容，再同步给专员。
                </p>
              </div>

              <div className="rounded-2xl bg-blue-50 p-4 ring-1 ring-blue-200">
                <div className="flex items-center gap-2">
                  <StatusPill tone="blue">AI 已回答</StatusPill>
                  <p className="text-sm font-medium text-blue-900">
                    需要核对 AI 是否答对
                  </p>
                </div>
                <p className="mt-2 text-sm leading-6 text-blue-800">
                  若 AI 判定有误，进入详情后改写主管结论，必要时沉淀回知识库。
                </p>
              </div>

              <div className="rounded-2xl bg-green-50 p-4 ring-1 ring-green-200">
                <div className="flex items-center gap-2">
                  <StatusPill tone="green">已完成</StatusPill>
                  <p className="text-sm font-medium text-green-900">
                    结果已沉淀或已回复
                  </p>
                </div>
                <p className="mt-2 text-sm leading-6 text-green-800">
                  可继续抽样复盘高频问题，筛选是否需要补规则或修订共识。
                </p>
              </div>
            </div>
          </WorkspaceSection>

          <WorkspaceSection
            title="快捷动作"
            description="保持和知识库页面相同的右侧工具区使用方式。"
          >
            <div className="flex flex-col gap-3">
              <WorkspaceActionLink
                href="/api/reviews/export?format=csv"
                tone="slate"
                outline
              >
                导出当前复核列表
              </WorkspaceActionLink>
              <WorkspaceActionLink href="/conversations" tone="blue" outline>
                查看全量问答日志
              </WorkspaceActionLink>
              {isLeader ? (
                <WorkspaceActionLink href="/storage" tone="amber" outline>
                  打开存储诊断
                </WorkspaceActionLink>
              ) : null}
            </div>
          </WorkspaceSection>
        </div>
      </div>
    </AdminShell>
  );
}
