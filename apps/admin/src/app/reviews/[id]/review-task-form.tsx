"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  saveReviewTaskAction,
  saveAndSinkReviewTaskAction,
  type SaveReviewFormState,
} from "../actions";
import type { ReviewTask, ReviewTaskStatus } from "@/lib/types";

const statuses: ReviewTaskStatus[] = [
  "待处理",
  "AI已自动回答",
  "已处理",
  "已加入知识库",
  "待补充",
];

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

  const [saveState, saveAction, savePending] = useActionState<
    SaveReviewFormState,
    FormData
  >(saveReviewTaskAction, null);

  const [sinkState, sinkAction, sinkPending] = useActionState<
    SaveReviewFormState,
    FormData
  >(saveAndSinkReviewTaskAction, null);

  useEffect(() => {
    if (saveState?.ok === true || sinkState?.ok === true) {
      router.refresh();
    }
  }, [saveState, sinkState, router]);

  const autoAnswer = parseAutoAnswer(task);
  const state = sinkState ?? saveState;
  const pending = savePending || sinkPending;

  return (
    <div className="space-y-6">
      {/* AI 原始回答展示区 */}
      {autoAnswer && (
        <div className="rounded-2xl bg-blue-50 p-6 ring-1 ring-blue-100">
          <h2 className="text-base font-semibold text-blue-800">
            AI 原始回答（仅供参考）
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm">
            {autoAnswer.verdict && (
              <div>
                <p className="text-xs text-blue-500">判定结论</p>
                <p className="mt-1 font-medium text-blue-900">
                  {autoAnswer.verdict}
                </p>
              </div>
            )}
            {autoAnswer.deductionScore !== undefined && (
              <div>
                <p className="text-xs text-blue-500">AI 建议扣分</p>
                <p className="mt-1 font-medium text-blue-900">
                  {autoAnswer.deductionScore} 分
                </p>
              </div>
            )}
            {autoAnswer.clauseTitle && (
              <div>
                <p className="text-xs text-blue-500">条款标题</p>
                <p className="mt-1 text-blue-900">{autoAnswer.clauseTitle}</p>
              </div>
            )}
            {autoAnswer.clauseCode && (
              <div>
                <p className="text-xs text-blue-500">条款编号</p>
                <p className="mt-1 text-blue-900">{autoAnswer.clauseCode}</p>
              </div>
            )}
            {autoAnswer.aiExplanation && (
              <div className="md:col-span-2">
                <p className="text-xs text-blue-500">AI 解释</p>
                <p className="mt-1 leading-6 text-blue-800">
                  {autoAnswer.aiExplanation}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 处理结果表单（两个 action 共用相同字段，通过不同 formAction 区分） */}
      <div className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]">
        <h2 className="text-xl font-semibold text-gray-900">处理结果</h2>

        <div className="mt-6 grid gap-4 md:grid-cols-2" id={`form-${task.id}`}>
          <label className="flex flex-col gap-2 text-sm text-gray-700">
            <span>任务状态</span>
            <select
              name="status"
              form={`save-form-${task.id}`}
              defaultValue={task.status}
              className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
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
              className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
              placeholder="例如：张主管"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-gray-700">
            <span>最终结论</span>
            <input
              name="finalConclusion"
              form={`save-form-${task.id}`}
              defaultValue={task.finalConclusion}
              className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
              placeholder="例如：扣分 / 不扣分 / 可外购 / 是旧品"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-gray-700">
            <span>最终分值</span>
            <input
              name="finalScore"
              form={`save-form-${task.id}`}
              defaultValue={task.finalScore}
              className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
              placeholder="例如：15"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-gray-700 md:col-span-2">
            <span>最终依据条款</span>
            <input
              name="finalClause"
              form={`save-form-${task.id}`}
              defaultValue={task.finalClause}
              className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
              placeholder="例如：H3.3"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-gray-700 md:col-span-2">
            <span>最终解释</span>
            <textarea
              name="finalExplanation"
              form={`save-form-${task.id}`}
              defaultValue={task.finalExplanation}
              className="min-h-36 rounded-xl border border-gray-200 px-4 py-3 outline-none"
              placeholder="填写最终处理口径，后续可作为知识沉淀来源。"
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
          <button
            type="submit"
            form={`save-form-${task.id}`}
            disabled={pending}
            className="rounded-xl bg-green-700 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-green-400"
          >
            {savePending ? "保存中..." : "保存并回复专员"}
          </button>

          <SinkButton
            taskId={task.id}
            pending={pending}
            sinkAction={sinkAction}
            saveFormId={`save-form-${task.id}`}
          />

          {state?.message ? (
            <p
              className={`text-sm ${state.ok === false ? "text-red-600" : "text-gray-600"}`}
              role={state.ok === false ? "alert" : undefined}
            >
              {state.message}
            </p>
          ) : null}
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

    const sinkFields = document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[form="${saveFormId}"]`,
    );
    sinkFields.forEach((el) => {
      if (el.name && el.name !== "taskId") {
        fd.set(el.name, el.value);
      }
    });

    fd.set("taskId", taskId);
    sinkAction(fd);
  }

  return (
    <button
      type="button"
      onClick={handleSink}
      disabled={pending}
      className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-emerald-400"
    >
      {pending ? "处理中..." : "保存并加入知识库"}
    </button>
  );
}
