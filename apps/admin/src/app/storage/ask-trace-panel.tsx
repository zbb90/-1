"use client";

import { useState } from "react";
import { WorkspaceActionButton } from "@/components/admin/knowledge-workspace";

interface StageResult {
  name: string;
  ok: boolean;
  ms: number;
  data?: unknown;
  error?: { name: string; message: string; stack?: string };
}

interface TraceResult {
  ok: boolean;
  stages: StageResult[];
  payload?: unknown;
  message?: string;
}

const ENDPOINT = "/api/admin/diagnostics/ask-trace";

export function AskTracePanel() {
  const [result, setResult] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeWrite, setIncludeWrite] = useState(false);

  async function runTrace(opts: { writeReview: boolean }) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storeCode: "DIAG",
          category: "稽核",
          issueTitle: "门店在打烊前1小时，可下架新品、重点品扣分吗",
          description: "门店在打烊前1小时，可下架新品、重点品扣分吗",
          dryRun: !opts.writeReview,
        }),
        cache: "no-store",
      });
      const data = (await res.json()) as TraceResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const allOk = result?.stages?.every((s) => s.ok) ?? false;
  const failedStage = result?.stages?.find((s) => !s.ok);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600 ring-1 ring-slate-200">
        <p className="font-medium text-slate-800">ask 接口诊断</p>
        <p className="mt-1">
          点击按钮后，会向 ask 核心链路发送一条测试问题，逐阶段显示是否成功。
          可在不打开浏览器 Console 的情况下快速定位 500 根因。
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <WorkspaceActionButton
          type="button"
          tone="violet"
          onClick={() => {
            setIncludeWrite(false);
            runTrace({ writeReview: false });
          }}
          disabled={loading}
        >
          {loading && !includeWrite ? "诊断中…" : "运行 ask 诊断（dryRun）"}
        </WorkspaceActionButton>
        <WorkspaceActionButton
          type="button"
          tone="amber"
          onClick={() => {
            setIncludeWrite(true);
            runTrace({ writeReview: true });
          }}
          disabled={loading}
        >
          {loading && includeWrite ? "诊断中…" : "完整诊断（含写复核池）"}
        </WorkspaceActionButton>
        {result ? (
          <span
            className={`text-sm font-medium ${allOk ? "text-green-600" : "text-red-600"}`}
          >
            {allOk ? "✓ 全部通过" : `✗ ${failedStage?.name ?? "某阶段"} 失败`}
          </span>
        ) : null}
      </div>

      {result?.stages ? (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-200">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">阶段</th>
                <th className="px-4 py-2">状态</th>
                <th className="px-4 py-2">耗时</th>
                <th className="px-4 py-2">详情</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {result.stages.map((stage) => (
                <tr key={stage.name}>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">
                    {stage.name}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        stage.ok
                          ? "bg-green-50 text-green-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {stage.ok ? "ok" : "fail"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{stage.ms} ms</td>
                  <td className="px-4 py-2 text-xs">
                    {stage.error ? (
                      <div className="space-y-1">
                        <p className="font-medium text-red-700">
                          {stage.error.name}: {stage.error.message}
                        </p>
                        {stage.error.stack ? (
                          <details>
                            <summary className="cursor-pointer text-slate-500">
                              展开堆栈
                            </summary>
                            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600">
                              {stage.error.stack}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    ) : stage.data !== undefined ? (
                      <pre className="max-h-20 max-w-xs overflow-auto whitespace-pre-wrap text-[11px] text-slate-600">
                        {JSON.stringify(stage.data, null, 2)}
                      </pre>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
