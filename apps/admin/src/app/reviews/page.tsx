import Link from "next/link";
import { cookies } from "next/headers";
import { listReviewTasks } from "@/lib/review-pool";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function ReviewsPage() {
  const tasks = await listReviewTasks();
  const cookieStore = await cookies();
  const isLeader = cookieStore.get("audit_role")?.value === "leader";

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
            extraActions={
              <Link
                href="/api/reviews/export?format=csv"
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
              >
                导出 CSV
              </Link>
            }
          />
        }
      />

      <section className="space-y-4">
        {tasks.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            目前还没有复核任务。后续当系统无法判断时，会自动进入这里。
          </div>
        ) : (
          tasks.map((task) => (
            <Link
              key={task.id}
              href={`/reviews/${task.id}`}
              className="block rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 transition hover:ring-green-200"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{task.id}</p>
                  <p className="mt-1 text-sm text-gray-500">
                    {task.type}｜门店编码：{task.storeCode}
                  </p>
                </div>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  {task.status}
                </span>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs text-gray-500">分类</p>
                  <p className="mt-1 text-sm text-gray-800">{task.category}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">自行判断</p>
                  <p className="mt-1 text-sm text-gray-800">{task.selfJudgment}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">提问人</p>
                  <p className="mt-1 text-sm text-gray-800">{task.requester}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs text-gray-500">问题描述</p>
                  <p className="mt-1 text-sm leading-6 text-gray-800">
                    {task.description}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs text-gray-500">系统拒答原因</p>
                  <p className="mt-1 text-sm leading-6 text-gray-800">
                    {task.rejectReason}
                  </p>
                </div>
              </div>
            </Link>
          ))
        )}
      </section>
    </AdminShell>
  );
}
