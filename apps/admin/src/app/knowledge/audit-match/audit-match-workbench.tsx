"use client";

import { useMemo, useState } from "react";
import type {
  AuditConsensusAnalysis,
  AuditConsensusMatchResult,
  MatchStatus,
} from "@/lib/audit-match-types";

const STATUS_LABELS: Record<MatchStatus, string> = {
  matched: "高置信命中",
  review: "待人工复核",
  unmatched: "未匹配",
};

function statusClass(status: MatchStatus) {
  if (status === "matched") return "bg-green-50 text-green-700 ring-green-200";
  if (status === "review") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "slate" | "green" | "amber" | "violet";
}) {
  const toneClass = {
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
    green: "bg-green-50 text-green-700 ring-green-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
  }[tone];

  return (
    <div className={`rounded-2xl px-4 py-3 ring-1 ${toneClass}`}>
      <p className="text-xs font-medium tracking-wide opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AuditMatchWorkbench() {
  const [auditFile, setAuditFile] = useState<File | null>(null);
  const [consensusFile, setConsensusFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [analysis, setAnalysis] = useState<AuditConsensusAnalysis | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | MatchStatus>("all");
  const [approvedKeys, setApprovedKeys] = useState<string[]>([]);

  const filteredResults = useMemo(() => {
    const results = analysis?.results ?? [];
    return results
      .filter((item) => (statusFilter === "all" ? true : item.status === statusFilter))
      .sort((left, right) => right.confidence - left.confidence);
  }, [analysis?.results, statusFilter]);

  const approvedSet = useMemo(() => new Set(approvedKeys), [approvedKeys]);

  async function handleAnalyze() {
    if (!auditFile || !consensusFile) {
      setMessage("请先选择稽核表和共识表 Excel。");
      return;
    }
    setAnalyzing(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("auditFile", auditFile);
      formData.append("consensusFile", consensusFile);
      const response = await fetch("/api/knowledge/audit-match", {
        method: "POST",
        body: formData,
      });
      const json = await response.json();
      if (!json.ok) {
        setMessage(json.message || "分析失败");
        return;
      }
      const data = json.data as AuditConsensusAnalysis;
      setAnalysis(data);
      setApprovedKeys(
        data.results
          .filter((item) => item.status === "matched" && item.bestMatch)
          .map((item) => item.auditKey),
      );
      setMessage(`分析完成，共处理 ${data.summary.totalAuditClauses} 条稽核条款。`);
    } catch {
      setMessage("网络异常，无法完成匹配分析。");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleExport(format: "xlsx" | "csv") {
    if (!analysis) return;
    setExporting(true);
    try {
      const response = await fetch("/api/knowledge/audit-match/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          selectedKeys: approvedKeys,
          analysis,
        }),
      });
      if (!response.ok) {
        const json = (await response.json()) as { message?: string };
        setMessage(json.message || "导出失败");
        return;
      }
      const blob = await response.blob();
      downloadFile(
        blob,
        format === "csv"
          ? "audit_consensus_match_results.csv"
          : "audit_consensus_match_results.xlsx",
      );
    } catch {
      setMessage("导出失败，请稍后重试。");
    } finally {
      setExporting(false);
    }
  }

  function toggleApproved(result: AuditConsensusMatchResult) {
    if (!result.bestMatch) return;
    setApprovedKeys((current) =>
      current.includes(result.auditKey)
        ? current.filter((item) => item !== result.auditKey)
        : [...current, result.auditKey],
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="rounded-2xl border border-dashed border-gray-300 bg-slate-50 p-4">
            <p className="text-sm font-medium text-gray-900">上传稽核表</p>
            <p className="mt-1 text-xs text-gray-500">
              支持 `.xlsx/.xls`，按古茗稽核表结构读取第 2 行表头。
            </p>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="mt-4 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-green-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
              onChange={(event) => setAuditFile(event.target.files?.[0] ?? null)}
            />
            {auditFile ? (
              <p className="mt-3 text-xs text-green-700">已选择：{auditFile.name}</p>
            ) : null}
          </label>

          <label className="rounded-2xl border border-dashed border-gray-300 bg-slate-50 p-4">
            <p className="text-sm font-medium text-gray-900">上传共识表</p>
            <p className="mt-1 text-xs text-gray-500">
              优先使用 `title + consensus_desc_txt` 做语义匹配。
            </p>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="mt-4 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
              onChange={(event) => setConsensusFile(event.target.files?.[0] ?? null)}
            />
            {consensusFile ? (
              <p className="mt-3 text-xs text-blue-700">已选择：{consensusFile.name}</p>
            ) : null}
          </label>

          <div className="flex flex-col gap-3 lg:justify-end">
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="rounded-xl bg-green-700 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-green-800 disabled:bg-green-300"
            >
              {analyzing ? "分析中..." : "开始 AI 匹配"}
            </button>
            <button
              onClick={() => handleExport("xlsx")}
              disabled={!analysis || exporting}
              className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              导出分析与草稿
            </button>
            <button
              onClick={() => handleExport("csv")}
              disabled={!analysis || exporting}
              className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              导出 CSV
            </button>
          </div>
        </div>

        {message ? (
          <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {message}
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          当前流程不会直接写入正式知识库。你可以先查看结果，勾选确认项，再导出“知识沉淀草稿”给人工复核后入库。
        </div>
      </section>

      {analysis ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <SummaryCard
              label="稽核条款"
              value={analysis.summary.totalAuditClauses}
              tone="slate"
            />
            <SummaryCard
              label="共识数"
              value={analysis.summary.totalConsensus}
              tone="violet"
            />
            <SummaryCard
              label="高置信命中"
              value={analysis.summary.matched}
              tone="green"
            />
            <SummaryCard
              label="待人工复核"
              value={analysis.summary.reviewRequired}
              tone="amber"
            />
            <SummaryCard
              label="平均置信度"
              value={`${Math.round(analysis.summary.averageConfidence * 100)}%`}
              tone="slate"
            />
          </section>

          {(analysis.warnings?.length ?? 0) > 0 ? (
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">解析提示</h2>
              <div className="mt-3 space-y-2 text-sm text-amber-700">
                {analysis.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setStatusFilter("all")}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  statusFilter === "all"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                全部结果
              </button>
              {(["matched", "review", "unmatched"] as MatchStatus[]).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                    statusFilter === status
                      ? "bg-green-700 text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}

              <div className="ml-auto text-xs text-gray-500">
                已勾选入库草稿 {approvedKeys.length} 条
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {filteredResults.map((result) => (
                <article
                  key={result.auditKey}
                  className="rounded-2xl border border-gray-200 bg-slate-50 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClass(result.status)}`}
                        >
                          {STATUS_LABELS[result.status]}
                        </span>
                        <span className="text-xs text-gray-500">
                          置信度 {Math.round(result.confidence * 100)}%
                        </span>
                        <span className="text-xs text-gray-500">
                          {result.auditClause.auditId} · {result.auditClause.level}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-gray-900">
                        {result.auditClause.clauseTitle}
                      </h3>
                      <p className="text-sm text-gray-600">
                        维度 {result.auditClause.dimension || "-"} · 分值{" "}
                        {result.auditClause.score ?? "-"}
                      </p>
                    </div>

                    <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-gray-700 ring-1 ring-gray-200">
                      <input
                        type="checkbox"
                        checked={approvedSet.has(result.auditKey)}
                        disabled={!result.bestMatch}
                        onChange={() => toggleApproved(result)}
                      />
                      加入入库草稿
                    </label>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <div className="rounded-2xl bg-white p-4 ring-1 ring-gray-200">
                      <p className="text-xs font-medium tracking-wide text-gray-500">
                        推荐结果
                      </p>
                      {result.bestMatch ? (
                        <div className="mt-3 space-y-2 text-sm text-gray-700">
                          <p className="font-medium text-gray-900">
                            {result.bestMatch.consensusId}｜{result.bestMatch.title}
                          </p>
                          <p>
                            类型 {result.bestMatch.type || "-"} · clauseId{" "}
                            {result.bestMatch.clauseId || "-"}
                          </p>
                          <p className="text-sm text-slate-600">
                            {result.bestMatch.contentText || "暂无共识正文"}
                          </p>
                          <p className="text-xs text-gray-500">
                            关键词分 {result.bestMatch.keywordScore.toFixed(2)}
                            {result.bestMatch.semanticScore !== null
                              ? ` · 语义分 ${result.bestMatch.semanticScore.toFixed(2)}`
                              : ""}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-gray-500">
                          当前未找到可信共识候选。
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl bg-white p-4 ring-1 ring-gray-200">
                      <p className="text-xs font-medium tracking-wide text-gray-500">
                        匹配理由与候选
                      </p>
                      <div className="mt-3 space-y-3 text-sm text-gray-700">
                        <div>
                          <p className="font-medium text-gray-900">判断理由</p>
                          <div className="mt-1 space-y-1 text-sm text-slate-600">
                            {result.reasons.map((reason) => (
                              <p key={`${result.auditKey}-${reason}`}>{reason}</p>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">候选列表</p>
                          <div className="mt-1 space-y-2">
                            {result.candidates.slice(0, 3).map((candidate) => (
                              <div
                                key={`${result.auditKey}-${candidate.consensusId}`}
                                className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200"
                              >
                                <p className="font-medium text-slate-800">
                                  {candidate.consensusId}｜{candidate.title}
                                </p>
                                <p className="mt-1">
                                  综合分 {candidate.finalScore.toFixed(2)} · 关键词{" "}
                                  {candidate.keywordScore.toFixed(2)}
                                  {candidate.semanticScore !== null
                                    ? ` · 语义 ${candidate.semanticScore.toFixed(2)}`
                                    : ""}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              ))}

              {filteredResults.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-gray-500">
                  当前筛选条件下没有结果。
                </p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
