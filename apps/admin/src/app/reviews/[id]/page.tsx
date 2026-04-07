import Link from "next/link";
import { notFound } from "next/navigation";
import { getReviewTaskById } from "@/lib/review-pool";
import { ReviewTaskForm } from "./review-task-form";

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const task = await getReviewTaskById(id);

  if (!task) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[var(--background)] p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-3xl bg-[var(--card)] p-8 shadow-sm ring-1 ring-[var(--border)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-green-700">人工复核池</p>
              <h1 className="mt-2 text-3xl font-bold text-gray-900">
                复核任务详情
              </h1>
              <p className="mt-3 text-sm leading-6 text-gray-600">
                当前任务编号：{task.id}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href="/conversations"
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-gray-700"
              >
                问答日志
              </Link>
              <Link
                href="/reviews"
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-gray-700"
              >
                复核池
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-6">
            <div className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]">
              <h2 className="text-xl font-semibold text-gray-900">任务信息</h2>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs text-gray-500">任务类型</p>
                  <p className="mt-1 text-sm text-gray-800">{task.type}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">当前状态</p>
                  <p className="mt-1 text-sm text-gray-800">{task.status}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">门店编码</p>
                  <p className="mt-1 text-sm text-gray-800">{task.storeCode}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">问题分类</p>
                  <p className="mt-1 text-sm text-gray-800">{task.category}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">提问人</p>
                  <p className="mt-1 text-sm text-gray-800">{task.requester}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">自行判断</p>
                  <p className="mt-1 text-sm text-gray-800">
                    {task.selfJudgment}
                  </p>
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
            </div>

            <div className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]">
              <h2 className="text-xl font-semibold text-gray-900">
                原始请求数据
              </h2>
              <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-700">
                {task.sourcePayload}
              </pre>
            </div>
          </div>

          <div>
            <ReviewTaskForm task={task} />
          </div>
        </section>
      </div>
    </main>
  );
}
