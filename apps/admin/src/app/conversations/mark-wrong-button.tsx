"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceActionButton } from "@/components/admin/knowledge-workspace";

export function MarkWrongButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!confirm("确认标记该 AI 回答有误，并将其转入人工复核池？此操作无法自动撤销。"))
      return;

    setLoading(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const json = await res.json();
      if (json.ok) {
        router.refresh();
      } else {
        alert(`操作失败：${json.message}`);
      }
    } catch {
      alert("网络错误，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <WorkspaceActionButton
      onClick={handleClick}
      disabled={loading}
      tone="red"
      className="px-4 py-2 text-xs"
    >
      {loading ? "处理中..." : "标记答错，转人工复核"}
    </WorkspaceActionButton>
  );
}
