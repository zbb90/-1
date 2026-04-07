import Link from "next/link";
import { listReviewTasks } from "@/lib/review-pool";
import { adminLogoutAction } from "@/app/reviews/actions";
import type { ReviewTask, ReviewTaskStatus } from "@/lib/types";
import { MarkWrongButton } from "./mark-wrong-button";

const STATUS_LABELS: Record<ReviewTaskStatus, string> = {
  AI已自动回答: "AI 已自动回答",
  待处理: "待处理",
  已处理: "已处理",
  已加入知识库: "已加入知识库",
  待补充: "待补充",
};

const STATUS_COLORS: Record<ReviewTaskStatus, string> = {
  AI已自动回答: "bg-blue-50 text-blue-700",
  待处理: "bg-amber-50 text-amber-700",
  已处理: "bg-green-50 text-green-700",
  已加入知识库: "bg-emerald-50 text-emerald-700",
  待补充: "bg-rose-50 text-rose-700",
};

const FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "全部" },
  { value: "AI已自动回答", label: "AI 已自动回答" },
  { value: "待处理", label: "待处理" },
  { value: "已处理", label: "已处理" },
  { value: "已加入知识库", label: "已加入知识库" },
  { value: "待补充", label: "待补充" },
];

function parseAutoAnswer(task: ReviewTask) {
  try {
    const payload = JSON.parse(task.sourcePayload);
    return payload?.autoAnswer ?? null;
  } catch {
    return null;
  }
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: filterStatus } = await searchParams;
  const allTasks = await listReviewTasks();

  const tasks = filterStatus
    ? allTasks.filter((t) => t.status === filterStatus)
    : allTasks;

  return (
    <main className="min-h-screen bg-[var(--background)] p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* 页面头部 */}
        <section className="rounded-3xl bg-[var(--card)] p-8 shadow-sm ring-1 ring-[var(--border)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-green-700">问答日志</p>
              <h1 className="mt-2 text-3xl font-bold text-gray-900">
                全量问答记录
              </h1>
              <p className="mt-3 text-sm leading-6 text-gray-600">
                所有专员提问均会在此记录，无论是否命中规则。主管可标记 &ldquo;AI
                已自动回答&rdquo;的记录为答错，转入人工复核池。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/reviews"
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                复核池
              </Link>
              <Link
                href="/knowledge"
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                知识库管理
              </Link>
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

          {/* 统计 */}
          <div className="mt-6 flex flex-wrap gap-4">
            {FILTER_OPTIONS.filter((o) => o.value).map((opt) => {
              const count = allTasks.filter(
                (t) => t.status === opt.value,
              ).length;
              return (
                <div
                  key={opt.value}
                  className="rounded-xl bg-gray-50 px-4 py-2 text-sm"
                >
                  <span className="text-gray-500">{opt.label}：</span>
                  <span className="font-semibold text-gray-800">{count}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* 过滤器 */}
        <div className="flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((opt) => (
            <Link
              key={opt.value}
              href={
                opt.value
                  ? `/conversations?status=${encodeURIComponent(opt.value)}`
                  : "/conversations"
              }
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                (filterStatus ?? "") === opt.value
                  ? "bg-green-700 text-white"
                  : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>

        {/* 列表 */}
        <section className="space-y-4">
          {tasks.length === 0 ? (
            <div className="rounded-2xl bg-[var(--card)] p-8 text-sm text-gray-500 shadow-sm ring-1 ring-[var(--border)]">
              暂无符合条件的问答记录。
            </div>
          ) : (
            tasks.map((task) => {
              const autoAnswer = parseAutoAnswer(task);
              return (
                <div
                  key={task.id}
                  className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {task.id}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {task.type}｜{task.requester}｜门店：{task.storeCode}｜
                        {new Date(task.createdAt).toLocaleString("zh-CN")}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLORS[task.status as ReviewTaskStatus] ?? "bg-gray-50 text-gray-700"}`}
                    >
                      {STATUS_LABELS[task.status as ReviewTaskStatus] ??
                        task.status}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs text-gray-500">问题分类</p>
                      <p className="mt-1 text-sm text-gray-800">
                        {task.category}
                      </p>
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

                    {autoAnswer && (
                      <div className="md:col-span-2 rounded-xl bg-blue-50 p-4">
                        <p className="text-xs font-medium text-blue-700 mb-2">
                          AI 自动回答
                        </p>
                        <div className="grid gap-2 md:grid-cols-3 text-sm">
                          {autoAnswer.verdict && (
                            <div>
                              <span className="text-xs text-blue-500">
                                判定：
                              </span>
                              <span className="text-blue-900 font-medium">
                                {autoAnswer.verdict}
                              </span>
                            </div>
                          )}
                          {autoAnswer.deductionScore !== undefined && (
                            <div>
                              <span className="text-xs text-blue-500">
                                扣分：
                              </span>
                              <span className="text-blue-900 font-medium">
                                {autoAnswer.deductionScore} 分
                              </span>
                            </div>
                          )}
                          {autoAnswer.clauseTitle && (
                            <div>
                              <span className="text-xs text-blue-500">
                                条款：
                              </span>
                              <span className="text-blue-900">
                                {autoAnswer.clauseTitle}
                              </span>
                            </div>
                          )}
                        </div>
                        {autoAnswer.aiExplanation && (
                          <p className="mt-2 text-xs leading-5 text-blue-800">
                            {autoAnswer.aiExplanation}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Link
                      href={`/reviews/${task.id}`}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      查看详情 / 处理
                    </Link>
                    {task.status === "AI已自动回答" && (
                      <MarkWrongButton taskId={task.id} />
                    )}
                    {task.status === "待处理" && (
                      <Link
                        href={`/reviews/${task.id}`}
                        className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700"
                      >
                        去处理
                      </Link>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
