"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveReviewTaskAction, type SaveReviewFormState } from "../actions";
import type { ReviewTask, ReviewTaskStatus } from "@/lib/types";

const statuses: ReviewTaskStatus[] = [
  "待处理",
  "已处理",
  "已加入知识库",
  "待补充",
];

export function ReviewTaskForm({ task }: { task: ReviewTask }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SaveReviewFormState, FormData>(
    saveReviewTaskAction,
    null,
  );

  useEffect(() => {
    if (state?.ok === true) {
      router.refresh();
    }
  }, [state, router]);

  return (
    <form
      key={task.id}
      action={formAction}
      className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]"
    >
      <h2 className="text-xl font-semibold text-gray-900">处理结果</h2>

      <input type="hidden" name="taskId" value={task.id} />

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-gray-700">
          <span>任务状态</span>
          <select
            name="status"
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
            defaultValue={task.processor}
            className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
            placeholder="例如：张主管"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-gray-700">
          <span>最终结论</span>
          <input
            name="finalConclusion"
            defaultValue={task.finalConclusion}
            className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
            placeholder="例如：扣分 / 不扣分 / 可外购 / 是旧品"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-gray-700">
          <span>最终分值</span>
          <input
            name="finalScore"
            defaultValue={task.finalScore}
            className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
            placeholder="例如：15"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-gray-700 md:col-span-2">
          <span>最终依据条款</span>
          <input
            name="finalClause"
            defaultValue={task.finalClause}
            className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
            placeholder="例如：H3.3"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-gray-700 md:col-span-2">
          <span>最终解释</span>
          <textarea
            name="finalExplanation"
            defaultValue={task.finalExplanation}
            className="min-h-36 rounded-xl border border-gray-200 px-4 py-3 outline-none"
            placeholder="填写最终处理口径，后续可作为知识沉淀来源。"
          />
        </label>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-green-700 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-green-400"
        >
          {pending ? "保存中..." : "保存处理结果"}
        </button>
        {state?.message ? (
          <p
            className={`text-sm ${state.ok === false ? "text-red-600" : "text-gray-600"}`}
            role={state.ok === false ? "alert" : undefined}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
