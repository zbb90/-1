"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  depositReviewToFaqAction,
  saveReviewTaskAction,
  saveAndSinkReviewTaskAction,
  type SaveReviewFormState,
} from "../actions";
import {
  StatusPill,
  WorkspaceActionButton,
  WorkspaceSection,
} from "@/components/admin/knowledge-workspace";
import type { ReviewTask, ReviewTaskStatus } from "@/lib/types";

const statuses: ReviewTaskStatus[] = [
  "待处理",
  "AI已自动回答",
  "已处理",
  "已加入知识库",
  "待补充",
];

const replyTemplates = [
  {
    id: "deduct",
    label: "扣分回复模板",
    conclusion: "扣分",
    score: "",
    reason: "请填写本次判定依据或现场触发原因",
    explanation: `【处理结论】
扣分，扣分值请结合规则填写。

【判定依据】
请填写本次人工判断依据，可直接手写原因，不要求填写规则编号。

【现场判断】
请补充现场实际情况，以及为什么符合本次判定场景。

【回复专员】
请按本次结论整改，并对照现场问题立即完成修正，避免再次发生。`,
  },
  {
    id: "no-deduct",
    label: "不扣分回复模板",
    conclusion: "不扣分",
    score: "0",
    reason: "请填写不扣分的判断原因",
    explanation: `【处理结论】
不扣分。

【判定依据】
请填写本次不扣分的原因，可直接手写判断口径或共识要点。

【现场判断】
请说明为什么本次情况不属于扣分场景，或属于可豁免情况。

【回复专员】
本次不扣分，但请按标准持续保持；若现场条件变化，请重新发起复核。`,
  },
  {
    id: "scene-based",
    label: "按场景判定模板",
    conclusion: "按场景判定",
    score: "",
    reason: "请填写需要补充判断的关键点",
    explanation: `【处理结论】
按场景判定，暂不直接给出固定扣分结论。

【判定依据】
请填写需要结合现场进一步确认的判断依据。

【现场判断】
请补充仍需确认的关键事实，例如储存位置、标签状态、是否实际使用等。

【回复专员】
请补充完整现场信息后再复核；信息确认前，先按风险项临时整改。`,
  },
] as const;

function parseAutoAnswer(task: ReviewTask) {
  try {
    const payload = JSON.parse(task.sourcePayload);
    return payload?.autoAnswer ?? null;
  } catch {
    return null;
  }
}

export function ReviewTaskForm({ task }: { task: ReviewTask }) {
  const router = useRouter();
  const conclusionRef = useRef<HTMLInputElement | null>(null);
  const scoreRef = useRef<HTMLInputElement | null>(null);
  const clauseRef = useRef<HTMLInputElement | null>(null);
  const explanationRef = useRef<HTMLTextAreaElement | null>(null);

  const [saveState, saveAction, savePending] = useActionState<
    SaveReviewFormState,
    FormData
  >(saveReviewTaskAction, null);

  const [sinkState, sinkAction, sinkPending] = useActionState<
    SaveReviewFormState,
    FormData
  >(saveAndSinkReviewTaskAction, null);

  const [faqState, faqAction, faqPending] = useActionState<
    SaveReviewFormState,
    FormData
  >(depositReviewToFaqAction, null);

  useEffect(() => {
    if (saveState?.ok === true || sinkState?.ok === true || faqState?.ok === true) {
      router.refresh();
    }
  }, [saveState, sinkState, faqState, router]);

  const autoAnswer = parseAutoAnswer(task);
  const state = faqState ?? sinkState ?? saveState;
  const pending = savePending || sinkPending || faqPending;
  const isCommonQuestion = task.type === "常规问题";

  function applyTemplate(template: (typeof replyTemplates)[number]) {
    if (conclusionRef.current) {
      conclusionRef.current.value = template.conclusion;
    }
    if (scoreRef.current) {
      scoreRef.current.value = template.score;
    }
    if (clauseRef.current && !clauseRef.current.value.trim()) {
      clauseRef.current.value = template.reason;
    }
    if (explanationRef.current) {
      explanationRef.current.value = template.explanation;
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <WorkspaceSection
          title="人工回复与知识沉淀"
          description="主管无需手填规则编号，可直接填写判定原因和给专员的回复内容。"
          actions={
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600 ring-1 ring-slate-200">
              建议顺序：先写结论，再写原因，最后补专员可执行的整改回复。
            </div>
          }
        >
          <div className="rounded-2xl bg-amber-50/80 p-4 ring-1 ring-amber-100">
            <p className="text-sm font-medium text-amber-900">快捷模板</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {replyTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className="rounded-full border border-amber-200 bg-white px-3 py-2 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
                >
                  {template.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2" id={`form-${task.id}`}>
            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>任务状态</span>
              <select
                name="status"
                form={`save-form-${task.id}`}
                defaultValue={task.status}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-3 outline-none transition focus:border-emerald-400"
              >
                {statuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>处理人</span>
              <input
                name="processor"
                form={`save-form-${task.id}`}
                defaultValue={task.processor}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-3 outline-none transition focus:border-emerald-400"
                placeholder="例如：张主管"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>最终结论</span>
              <input
                ref={conclusionRef}
                name="finalConclusion"
                form={`save-form-${task.id}`}
                defaultValue={task.finalConclusion}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-3 outline-none transition focus:border-emerald-400"
                placeholder="例如：扣分 / 不扣分 / 按场景判定"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-gray-700">
              <span>最终分值</span>
              <input
                ref={scoreRef}
                name="finalScore"
                form={`save-form-${task.id}`}
                defaultValue={task.finalScore}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-3 outline-none transition focus:border-emerald-400"
                placeholder="扣分填写具体分值，不扣分可填 0"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-gray-700 md:col-span-2">
              <span>判定依据 / 原因</span>
              <input
                ref={clauseRef}
                name="finalClause"
                form={`save-form-${task.id}`}
                defaultValue={task.finalClause}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-3 outline-none transition focus:border-emerald-400"
                placeholder="可直接手写原因，例如：阁楼物料直接落地，不符合未离地储存要求"
              />
              <span className="text-xs leading-5 text-gray-500">
                这里不强制填写规则编号，写清主管的判断依据即可。
              </span>
            </label>

            <label className="flex flex-col gap-2 text-sm text-gray-700 md:col-span-2">
              <span>回复内容</span>
              <textarea
                ref={explanationRef}
                name="finalExplanation"
                form={`save-form-${task.id}`}
                defaultValue={task.finalExplanation}
                className="min-h-44 rounded-2xl border border-gray-200 bg-white px-4 py-3 outline-none transition focus:border-emerald-400"
                placeholder="建议按“处理结论 / 判定依据 / 现场判断 / 回复专员”结构填写，便于后续知识沉淀。"
              />
            </label>
          </div>

          {/* 隐藏的 taskId，两个 form 都需要 */}
          <form id={`save-form-${task.id}`} action={saveAction}>
            <input type="hidden" name="taskId" value={task.id} />
          </form>
          <form id={`sink-form-${task.id}`} action={sinkAction}>
            <input type="hidden" name="taskId" value={task.id} />
            {/* 复制所有字段到 sink form，使用 JS 在提交时同步 */}
          </form>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <WorkspaceActionButton
              type="submit"
              form={`save-form-${task.id}`}
              disabled={pending}
              tone="green"
              className="px-5 py-3"
            >
              {savePending ? "保存中..." : "保存并回复专员"}
            </WorkspaceActionButton>

            <SinkButton
              taskId={task.id}
              pending={pending}
              sinkAction={sinkAction}
              saveFormId={`save-form-${task.id}`}
            />

            {isCommonQuestion ? (
              <FaqDepositButton
                taskId={task.id}
                pending={pending}
                faqAction={faqAction}
                saveFormId={`save-form-${task.id}`}
              />
            ) : null}

            {state?.message ? (
              <p
                className={`text-sm ${state.ok === false ? "text-red-600" : "text-gray-600"}`}
                role={state.ok === false ? "alert" : undefined}
              >
                {state.message}
              </p>
            ) : null}
          </div>
        </WorkspaceSection>

        <div className="space-y-5">
          {autoAnswer && (
            <WorkspaceSection
              title="AI 初步判断"
              description="AI 原始回答仅供主管复核参考，最终结论以主管人工处理为准。"
              className="overflow-hidden ring-sky-100"
            >
              <div className="grid gap-3 text-sm">
                {autoAnswer.verdict && (
                  <div className="rounded-2xl bg-sky-50 p-4">
                    <p className="text-xs text-sky-500">判定结论</p>
                    <p className="mt-1 font-medium text-slate-900">
                      {autoAnswer.verdict}
                    </p>
                  </div>
                )}
                {autoAnswer.deductionScore !== undefined && (
                  <div className="rounded-2xl bg-sky-50 p-4">
                    <p className="text-xs text-sky-500">AI 建议扣分</p>
                    <p className="mt-1 font-medium text-slate-900">
                      {autoAnswer.deductionScore} 分
                    </p>
                  </div>
                )}
                {autoAnswer.clauseTitle && (
                  <div className="rounded-2xl bg-sky-50 p-4">
                    <p className="text-xs text-sky-500">规则标题</p>
                    <p className="mt-1 text-slate-900">{autoAnswer.clauseTitle}</p>
                  </div>
                )}
                {autoAnswer.clauseCode && (
                  <div className="rounded-2xl bg-sky-50 p-4">
                    <p className="text-xs text-sky-500">规则编号</p>
                    <p className="mt-1 text-slate-900">{autoAnswer.clauseCode}</p>
                  </div>
                )}
                {autoAnswer.aiExplanation && (
                  <div className="rounded-2xl bg-sky-50 p-4">
                    <p className="text-xs text-sky-500">AI 解释</p>
                    <p className="mt-1 leading-6 text-slate-700">
                      {autoAnswer.aiExplanation}
                    </p>
                  </div>
                )}
              </div>
            </WorkspaceSection>
          )}

          <WorkspaceSection
            title="处理提示"
            description="右侧辅助区承接模板说明和提交流程。"
          >
            <div className="space-y-3">
              <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
                <div className="flex items-center gap-2">
                  <StatusPill tone="amber">先结论</StatusPill>
                </div>
                <p className="mt-2 text-sm leading-6 text-amber-800">
                  先明确扣分 / 不扣分 / 按场景判定，再补依据与回复，避免表述前后矛盾。
                </p>
              </div>
              <div className="rounded-2xl bg-blue-50 p-4 ring-1 ring-blue-200">
                <div className="flex items-center gap-2">
                  <StatusPill tone="blue">再沉淀</StatusPill>
                </div>
                <p className="mt-2 text-sm leading-6 text-blue-800">
                  如果这是高频错题或规则边界场景，建议直接同步加入知识库。
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <p className="text-sm font-medium text-slate-900">当前提交状态</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {pending
                    ? "正在提交，请稍候。"
                    : "可直接保存回复，或保存后同步沉淀。"}
                </p>
              </div>
            </div>
          </WorkspaceSection>
        </div>
      </div>
    </div>
  );
}

function SinkButton({
  taskId,
  pending,
  sinkAction,
  saveFormId,
}: {
  taskId: string;
  pending: boolean;
  sinkAction: (payload: FormData) => void;
  saveFormId: string;
}) {
  function handleSink() {
    const saveForm = document.getElementById(saveFormId) as HTMLFormElement | null;
    if (!saveForm) return;
    const fd = new FormData(saveForm);

    const sinkFields = document.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >(`[form="${saveFormId}"]`);
    sinkFields.forEach((el) => {
      if (el.name && el.name !== "taskId") {
        fd.set(el.name, el.value);
      }
    });

    fd.set("taskId", taskId);
    sinkAction(fd);
  }

  return (
    <WorkspaceActionButton
      type="button"
      onClick={handleSink}
      disabled={pending}
      tone="green"
      className="bg-emerald-700 px-5 py-3 hover:bg-emerald-800"
    >
      {pending ? "处理中..." : "保存并加入知识库"}
    </WorkspaceActionButton>
  );
}

function FaqDepositButton({
  taskId,
  pending,
  faqAction,
  saveFormId,
}: {
  taskId: string;
  pending: boolean;
  faqAction: (payload: FormData) => void;
  saveFormId: string;
}) {
  function handleDeposit() {
    const saveForm = document.getElementById(saveFormId) as HTMLFormElement | null;
    if (!saveForm) return;
    const fd = new FormData(saveForm);

    const fields = document.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >(`[form="${saveFormId}"]`);
    fields.forEach((el) => {
      if (el.name && el.name !== "taskId") {
        fd.set(el.name, el.value);
      }
    });

    fd.set("taskId", taskId);
    faqAction(fd);
  }

  return (
    <WorkspaceActionButton
      type="button"
      onClick={handleDeposit}
      disabled={pending}
      tone="blue"
      className="px-5 py-3"
    >
      {pending ? "处理中..." : "沉积到 FAQ"}
    </WorkspaceActionButton>
  );
}
