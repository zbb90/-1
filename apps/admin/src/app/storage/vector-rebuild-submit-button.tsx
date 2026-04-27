"use client";

import { useFormStatus } from "react-dom";

export function VectorRebuildSubmitButton({ className = "" }: { className?: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-wait disabled:opacity-70 ${className}`}
    >
      {pending ? "正在重建向量库，请稍候..." : "重建知识向量库（规则 + 共识 + FAQ）"}
    </button>
  );
}
