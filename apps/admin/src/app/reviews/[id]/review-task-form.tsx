"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewTask, ReviewTaskStatus } from "@/lib/types";

const statuses: ReviewTaskStatus[] = [
  "待处理",
  "已处理",
  "已加入知识库",
  "待补充",
];

export function ReviewTaskForm({ task }: { task: ReviewTask }) {
  const router = useRouter();
  const [status, setStatus] = useState<ReviewTaskStatus>(task.status);
  const [processor, setProcessor] = useState(task.processor);
  const [finalConclusion, setFinalConclusion] = useState(task.finalConclusion);
  const [finalScore, setFinalScore] = useState(task.finalScore);
  const [finalClause, setFinalClause] = useState(task.finalClause);
  const [finalExplanation, setFinalExplanation] = useState(task.finalExplanation);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    const response = await fetch(`/api/reviews/${task.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status,
        processor,
        finalConclusion,
        finalScore,
        finalClause,
        finalExplanation,
      }),
    });

    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      setMessage(result.message || "保存失败，请稍后重试。");
      setSaving(false);
      return;
    }

    setMessage("保存成功，复核任务已更新。");
    setSaving(false);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]"
    >
      <h2 className="text-xl font-semibold text-gray-900">处理结果</h2>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-gray-700">
          <span>任务状态</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ReviewTaskStatus)}
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
            value={processor}
            onChange={(event) => setProcessor(event.target.value)}
            className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
            placeholder="例如：张主管"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-gray-700">
          <span>最终结论</span>
          <input
            value={finalConclusion}
            onChange={(event) => setFinalConclusion(event.target.value)}
            className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
            placeholder="例如：扣分 / 不扣分 / 可外购 / 是旧品"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-gray-700">
          <span>最终分值</span>
          <input
            value={finalScore}
            onChange={(event) => setFinalScore(event.target.value)}
            className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
            placeholder="例如：15"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-gray-700 md:col-span-2">
          <span>最终依据条款</span>
          <input
            value={finalClause}
            onChange={(event) => setFinalClause(event.target.value)}
            className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
            placeholder="例如：H3.3"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-gray-700 md:col-span-2">
          <span>最终解释</span>
          <textarea
            value={finalExplanation}
            onChange={(event) => setFinalExplanation(event.target.value)}
            className="min-h-36 rounded-xl border border-gray-200 px-4 py-3 outline-none"
            placeholder="填写最终处理口径，后续可作为知识沉淀来源。"
          />
        </label>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-green-700 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-green-400"
        >
          {saving ? "保存中..." : "保存处理结果"}
        </button>
        {message ? <p className="text-sm text-gray-600">{message}</p> : null}
      </div>
    </form>
  );
}
