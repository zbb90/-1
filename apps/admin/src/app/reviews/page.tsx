import Link from "next/link";
import { listReviewTasks } from "@/lib/review-pool";
import { adminLogoutAction } from "./actions";

export default async function ReviewsPage() {
  const tasks = await listReviewTasks();

  return (
    <main className="min-h-screen bg-[var(--background)] p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-3xl bg-[var(--card)] p-8 shadow-sm ring-1 ring-[var(--border)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-green-700">人工复核池</p>
              <h1 className="mt-2 text-3xl font-bold text-gray-900">复核任务列表</h1>
              <p className="mt-3 text-sm leading-6 text-gray-600">
                当前已支持查看提问人、进入详情页处理，并给小程序侧提供“我的复核”筛选能力。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/conversations"
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                问答日志
              </Link>
              <Link
                href="/knowledge"
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                知识库管理
              </Link>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/api/reviews/export?format=csv"
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                导出复核结论
              </a>
              <form action={adminLogoutAction}>
                <button
                  type="submit"
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  退出登录
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          {tasks.length === 0 ? (
            <div className="rounded-2xl bg-[var(--card)] p-8 text-sm text-gray-500 shadow-sm ring-1 ring-[var(--border)]">
              目前还没有复核任务。后续当系统无法判断时，会自动进入这里。
            </div>
          ) : (
            tasks.map((task) => (
              <Link
                key={task.id}
                href={`/reviews/${task.id}`}
                className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]"
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
      </div>
    </main>
  );
}
