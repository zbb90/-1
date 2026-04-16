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
              <WorkspaceActionLink href="/api/reviews/export?format=csv" tone="slate" outline>
                导出 CSV
              </WorkspaceActionLink>
            }
          />
        }
      />

      <WorkspaceSection
        title="复核任务"
        description="统一使用知识库工作台风格的列表卡片展示全部复核任务。"
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
                  <StatusPill tone={status === "待处理" ? "amber" : status === "已处理" ? "green" : "slate"}>
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
    </AdminShell>
  );
}
