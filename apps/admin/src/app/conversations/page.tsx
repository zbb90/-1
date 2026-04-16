import Link from "next/link";
import { cookies } from "next/headers";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { listReviewTasks } from "@/lib/review-pool";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import type {
  RegularQuestionMatchDebug,
  ReviewTask,
  ReviewTaskStatus,
} from "@/lib/types";
import { MarkWrongButton } from "./mark-wrong-button";
import {
  StatusPill,
  WorkspaceEmptyState,
  WorkspaceSection,
} from "@/components/admin/knowledge-workspace";

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

function parseMatchingDebug(task: ReviewTask): RegularQuestionMatchDebug | null {
  try {
    const payload = JSON.parse(task.sourcePayload);
    return payload?.matchingDebug ?? null;
  } catch {
    return null;
  }
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topEntries(map: Map<string, number>, limit = 5) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function deriveQuestionPattern(
  task: ReviewTask,
  debug: RegularQuestionMatchDebug | null,
) {
  if (debug?.lowConfidenceReason) return "低置信度转人工";
  if (debug?.intentParse?.negationTags?.length) return "否定语境";
  if (debug?.intentParse?.claimTags?.length) return "带主张问法";
  if (task.description.includes("但是") || task.description.includes("不是"))
    return "转折问法";
  if (task.description && task.selfJudgment && task.selfJudgment !== "-")
    return "描述+自行判断";
  return "普通描述";
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: filterStatus } = await searchParams;
  const allTasks = await listReviewTasks();
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  const isLeader = session?.role === "leader";

  const tasks = filterStatus
    ? allTasks.filter((t) => t.status === filterStatus)
    : allTasks;
  const ruleStats = new Map<string, number>();
  const categoryStats = new Map<string, number>();
  const sceneStats = new Map<string, number>();
  const storeStats = new Map<string, number>();
  const patternStats = new Map<string, number>();
  const judgeModeStats = new Map<string, number>();
  const retrievalStats = new Map<string, number>();
  let usedComplexModelCount = 0;
  let escalatedCount = 0;
  let lowConfidenceCount = 0;
  let debugSnapshotCount = 0;

  for (const task of allTasks) {
    const autoAnswer = parseAutoAnswer(task);
    const debug = parseMatchingDebug(task);
    if (debug) {
      debugSnapshotCount += 1;
      if (debug.usedComplexModel) usedComplexModelCount += 1;
      if (debug.escalatedToReview) escalatedCount += 1;
      if (debug.lowConfidenceReason) lowConfidenceCount += 1;
      bump(judgeModeStats, debug.judgeMode || "未记录");
      const sources =
        debug.retrievalSources?.length && debug.retrievalSources.length > 0
          ? debug.retrievalSources
          : [debug.retrievalMode];
      sources.forEach((item) => bump(retrievalStats, item));
      const scenes =
        debug.intentParse?.sceneTags?.length && debug.intentParse.sceneTags.length > 0
          ? debug.intentParse.sceneTags
          : ["未识别场景"];
      scenes.forEach((item) => bump(sceneStats, item));
    }
    if (autoAnswer?.ruleId || autoAnswer?.clauseTitle) {
      bump(ruleStats, autoAnswer.ruleId || autoAnswer.clauseTitle);
    }
    bump(categoryStats, task.category || "未分类");
    bump(storeStats, task.storeCode || "未填写门店");
    bump(patternStats, deriveQuestionPattern(task, debug));
  }

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
        actions={
          <AdminNav
            current="conversations"
            showUsersLink={isLeader}
            showStorageLink={isLeader}
          />
        }
        footer={
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="rounded-xl bg-slate-50 px-4 py-2 text-sm ring-1 ring-slate-200">
                <span className="text-slate-500">带调试快照：</span>
                <span className="font-semibold text-slate-800">
                  {debugSnapshotCount}
                </span>
              </div>
              <div className="rounded-xl bg-violet-50 px-4 py-2 text-sm ring-1 ring-violet-200">
                <span className="text-violet-500">强模型触发：</span>
                <span className="font-semibold text-violet-800">
                  {usedComplexModelCount}
                </span>
              </div>
              <div className="rounded-xl bg-amber-50 px-4 py-2 text-sm ring-1 ring-amber-200">
                <span className="text-amber-600">低置信度转人工：</span>
                <span className="font-semibold text-amber-800">
                  {lowConfidenceCount}
                </span>
              </div>
              <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm ring-1 ring-rose-200">
                <span className="text-rose-500">已升级复核：</span>
                <span className="font-semibold text-rose-800">{escalatedCount}</span>
              </div>
            </div>
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[
          { title: "高频命中规则", data: topEntries(ruleStats) },
          { title: "高频问题分类", data: topEntries(categoryStats) },
          { title: "高频场景标签", data: topEntries(sceneStats) },
          { title: "高频门店", data: topEntries(storeStats) },
          { title: "提问方式", data: topEntries(patternStats) },
          {
            title: "裁判模式 / 召回来源",
            data: [...topEntries(judgeModeStats, 3), ...topEntries(retrievalStats, 3)],
          },
        ].map((panel) => (
          <div key={panel.title} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <p className="text-xs font-medium tracking-wide text-gray-500">
              错判分析视图
            </p>
            <h2 className="mt-1 text-lg font-semibold text-gray-900">{panel.title}</h2>
            <div className="mt-4 space-y-2">
              {panel.data.length === 0 ? (
                <p className="text-sm text-gray-500">暂无样本</p>
              ) : (
                panel.data.map(([label, count]) => (
                  <div
                    key={`${panel.title}-${label}`}
                    className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"
                  >
                    <span className="truncate text-gray-700">{label}</span>
                    <span className="font-semibold text-gray-900">{count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </section>

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

      <WorkspaceSection
        title="问答明细"
        description="按知识库工作台样式统一展示 AI 自动回答、调试快照与人工纠偏入口。"
      >
        <div className="space-y-4">
        {tasks.length === 0 ? (
          <WorkspaceEmptyState
            title="暂无符合条件的问答记录"
            description="可切换上方筛选条件，或等待新的专员提问进入系统。"
          />
        ) : (
          tasks.map((task) => {
            const autoAnswer = parseAutoAnswer(task);
            const debug = parseMatchingDebug(task);
            return (
              <div
                key={task.id}
                className="rounded-2xl border border-gray-100 bg-slate-50/60 p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{task.id}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {task.type}｜{task.requester}｜门店：{task.storeCode}｜
                      {new Date(task.createdAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <span className="inline-flex">
                    <StatusPill
                      tone={
                        task.status === "AI已自动回答"
                          ? "blue"
                          : task.status === "待处理"
                            ? "amber"
                            : task.status === "已处理" || task.status === "已加入知识库"
                              ? "green"
                              : "red"
                      }
                    >
                    {STATUS_LABELS[task.status as ReviewTaskStatus] ?? task.status}
                    </StatusPill>
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
                    <div className="md:col-span-2 rounded-2xl bg-blue-50 p-4 ring-1 ring-blue-100">
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

                  {debug && (
                    <div className="md:col-span-2 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                      <p className="mb-2 text-xs font-medium text-slate-600">
                        匹配调试快照
                      </p>
                      <div className="grid gap-2 text-sm md:grid-cols-2">
                        <div>
                          <span className="text-xs text-slate-500">裁判模式：</span>
                          <span className="font-medium text-slate-900">
                            {debug.judgeMode || "未记录"}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-500">召回来源：</span>
                          <span className="font-medium text-slate-900">
                            {debug.retrievalSources?.join(" / ") ||
                              debug.retrievalMode ||
                              "未记录"}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-500">强模型：</span>
                          <span className="font-medium text-slate-900">
                            {debug.usedComplexModel ? "已触发" : "未触发"}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-500">低置信度兜底：</span>
                          <span className="font-medium text-slate-900">
                            {debug.lowConfidenceReason || "未触发"}
                          </span>
                        </div>
                        <div className="md:col-span-2">
                          <span className="text-xs text-slate-500">意图摘要：</span>
                          <span className="ml-1 text-slate-800">
                            {debug.intentParse?.summary || "未记录"}
                          </span>
                        </div>
                        <div className="md:col-span-2">
                          <span className="text-xs text-slate-500">裁判原因：</span>
                          <span className="ml-1 text-slate-800">
                            {debug.judgeReason || "未记录"}
                          </span>
                        </div>
                      </div>
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
        </div>
      </WorkspaceSection>
    </AdminShell>
  );
}
