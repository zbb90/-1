import Link from "next/link";
import { cookies } from "next/headers";
import { listReviewTasks } from "@/lib/review-pool";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
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
  const cookieStore = await cookies();
  const isLeader = cookieStore.get("audit_role")?.value === "leader";

  const tasks = filterStatus
    ? allTasks.filter((t) => t.status === filterStatus)
    : allTasks;

  return (
    <AdminShell>
      <AdminPageHeader
        eyebrow="问答日志"
        title="全量问答记录"
        description={
          <>
            所有专员提问均会在此记录，无论是否命中规则。主管可标记 &ldquo;AI
            已自动回答&rdquo; 的记录为答错，转入人工复核池。
          </>
        }
        actions={<AdminNav current="conversations" showUsersLink={isLeader} />}
        footer={
          <div className="flex flex-wrap gap-3">
            {FILTER_OPTIONS.filter((o) => o.value).map((opt) => {
              const count = allTasks.filter((t) => t.status === opt.value).length;
              return (
                <div
                  key={opt.value}
                  className="rounded-xl bg-gray-50 px-4 py-2 text-sm ring-1 ring-gray-200"
                >
                  <span className="text-gray-500">{opt.label}：</span>
                  <span className="font-semibold text-gray-800">{count}</span>
                </div>
              );
            })}
          </div>
        }
      />

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

      <section className="space-y-4">
        {tasks.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            暂无符合条件的问答记录。
          </div>
        ) : (
          tasks.map((task) => {
            const autoAnswer = parseAutoAnswer(task);
            return (
              <div
                key={task.id}
                className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{task.id}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {task.type}｜{task.requester}｜门店：{task.storeCode}｜
                      {new Date(task.createdAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLORS[task.status as ReviewTaskStatus] ?? "bg-gray-50 text-gray-700"}`}
                  >
                    {STATUS_LABELS[task.status as ReviewTaskStatus] ?? task.status}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs text-gray-500">问题分类</p>
                    <p className="mt-1 text-sm text-gray-800">{task.category}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">自行判断</p>
                    <p className="mt-1 text-sm text-gray-800">{task.selfJudgment}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500">问题描述</p>
                    <p className="mt-1 text-sm leading-6 text-gray-800">
                      {task.description}
                    </p>
                  </div>

                  {autoAnswer && (
                    <div className="md:col-span-2 rounded-xl bg-blue-50 p-4">
                      <p className="mb-2 text-xs font-medium text-blue-700">
                        AI 自动回答
                      </p>
                      <div className="grid gap-2 text-sm md:grid-cols-3">
                        {autoAnswer.verdict && (
                          <div>
                            <span className="text-xs text-blue-500">判定：</span>
                            <span className="font-medium text-blue-900">
                              {autoAnswer.verdict}
                            </span>
                          </div>
                        )}
                        {autoAnswer.deductionScore !== undefined && (
                          <div>
                            <span className="text-xs text-blue-500">扣分：</span>
                            <span className="font-medium text-blue-900">
                              {autoAnswer.deductionScore} 分
                            </span>
                          </div>
                        )}
                        {autoAnswer.clauseTitle && (
                          <div>
                            <span className="text-xs text-blue-500">条款：</span>
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
                    className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    查看详情 / 处理
                  </Link>
                  {task.status === "AI已自动回答" && (
                    <MarkWrongButton taskId={task.id} />
                  )}
                  {task.status === "待处理" && (
                    <Link
                      href={`/reviews/${task.id}`}
                      className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-amber-700"
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
    </AdminShell>
  );
}
