"use client";

import { useMemo, useState } from "react";
import {
  StatusPill,
  WorkspaceMetric,
  WorkspacePill,
  WorkspaceSection,
} from "@/components/admin/knowledge-workspace";
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

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resultTone(status: MatchStatus) {
  if (status === "matched") return "green" as const;
  if (status === "review") return "amber" as const;
  return "slate" as const;
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
  const [selectedAuditKey, setSelectedAuditKey] = useState("");

  const filteredResults = useMemo(() => {
    const results = analysis?.results ?? [];
    return results
      .filter((item) => (statusFilter === "all" ? true : item.status === statusFilter))
      .sort((left, right) => right.confidence - left.confidence);
  }, [analysis?.results, statusFilter]);

  const approvedSet = useMemo(() => new Set(approvedKeys), [approvedKeys]);
  const selectedResult =
    filteredResults.find((item) => item.auditKey === selectedAuditKey) ??
    filteredResults[0] ??
    null;

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
      setSelectedAuditKey(data.results[0]?.auditKey ?? "");
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
      <WorkspaceSection
        title="匹配工作台"
        description="上传文件、开始分析、筛选结果与导出草稿都集中在同一个后台工具条区域。"
      >
        <div className="space-y-4">
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
                <p className="mt-3 text-xs text-blue-700">
                  已选择：{consensusFile.name}
                </p>
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
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
              {message}
            </div>
          ) : null}

          <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
            当前流程不会直接写入正式知识库。你可以先查看结果，勾选确认项，再导出“知识沉淀草稿”给人工复核后入库。
          </div>
        </div>
      </WorkspaceSection>

      {analysis ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <WorkspaceMetric
              label="稽核条款"
              value={analysis.summary.totalAuditClauses}
              tone="slate"
            />
            <WorkspaceMetric
              label="共识数"
              value={analysis.summary.totalConsensus}
              tone="violet"
            />
            <WorkspaceMetric
              label="高置信命中"
              value={analysis.summary.matched}
              tone="green"
            />
            <WorkspaceMetric
              label="待人工复核"
              value={analysis.summary.reviewRequired}
              tone="amber"
            />
            <WorkspaceMetric
              label="平均置信度"
              value={`${Math.round(analysis.summary.averageConfidence * 100)}%`}
              tone="blue"
            />
          </section>

          {(analysis.warnings?.length ?? 0) > 0 ? (
            <WorkspaceSection
              title="解析提示"
              description="这些提示不影响结果导出，但建议你先看一遍。"
            >
              <div className="space-y-2 text-sm text-amber-700">
                {analysis.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </WorkspaceSection>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
            <WorkspaceSection
              title="分析结果列表"
              description="左侧先看批量结果，右侧再看当前选中条目的详细解释与候选。"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <WorkspacePill
                    active={statusFilter === "all"}
                    onClick={() => setStatusFilter("all")}
                  >
                    全部结果
                  </WorkspacePill>
                  {(["matched", "review", "unmatched"] as MatchStatus[]).map(
                    (status) => (
                      <WorkspacePill
                        key={status}
                        active={statusFilter === status}
                        onClick={() => setStatusFilter(status)}
                      >
                        {STATUS_LABELS[status]}
                      </WorkspacePill>
                    ),
                  )}
                </div>
              }
            >
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <StatusPill tone="blue">
                  已勾选入库草稿 {approvedKeys.length} 条
                </StatusPill>
                <StatusPill tone="slate">
                  当前筛选 {filteredResults.length} 条
                </StatusPill>
              </div>
              {filteredResults.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-gray-500 ring-1 ring-slate-200">
                  当前筛选条件下没有结果。
                </p>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs font-medium text-gray-500">
                        <th className="px-4 py-3">状态</th>
                        <th className="px-4 py-3">稽核编号</th>
                        <th className="px-4 py-3">稽核条文</th>
                        <th className="px-4 py-3">推荐共识</th>
                        <th className="px-4 py-3">置信度</th>
                        <th className="px-4 py-3">草稿</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredResults.map((result) => {
                        const isSelected = selectedResult?.auditKey === result.auditKey;
                        return (
                          <tr
                            key={result.auditKey}
                            onClick={() => setSelectedAuditKey(result.auditKey)}
                            className={`cursor-pointer align-top ${
                              isSelected ? "bg-amber-50" : "hover:bg-slate-50"
                            }`}
                          >
                            <td className="px-4 py-3">
                              <StatusPill tone={resultTone(result.status)}>
                                {STATUS_LABELS[result.status]}
                              </StatusPill>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                              {result.auditClause.auditId}
                            </td>
                            <td className="min-w-[280px] max-w-[380px] px-4 py-3 text-gray-700">
                              <div className="space-y-1">
                                <p className="font-medium text-gray-900">
                                  {result.auditClause.clauseTitle}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {result.auditClause.level} · 维度{" "}
                                  {result.auditClause.dimension || "-"}
                                </p>
                              </div>
                            </td>
                            <td className="min-w-[220px] px-4 py-3 text-gray-700">
                              {result.bestMatch ? (
                                <div className="space-y-1">
                                  <p className="font-medium text-gray-900">
                                    {result.bestMatch.consensusId}｜
                                    {result.bestMatch.title}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {result.bestMatch.type || "未标记类型"}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-gray-400">未命中</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                              {Math.round(result.confidence * 100)}%
                            </td>
                            <td
                              className="px-4 py-3"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={approvedSet.has(result.auditKey)}
                                  disabled={!result.bestMatch}
                                  onChange={() => toggleApproved(result)}
                                />
                                选中
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </WorkspaceSection>

            <div className="space-y-5">
              <WorkspaceSection
                title="当前选中条目"
                description="先看结论、置信度和推荐共识，再展开看理由和候选。"
              >
                {selectedResult ? (
                  <div className="space-y-4 text-sm text-gray-700">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill tone={resultTone(selectedResult.status)}>
                          {STATUS_LABELS[selectedResult.status]}
                        </StatusPill>
                        <StatusPill tone="blue">
                          置信度 {Math.round(selectedResult.confidence * 100)}%
                        </StatusPill>
                      </div>
                      <h3 className="text-base font-semibold text-gray-900">
                        {selectedResult.auditClause.clauseTitle}
                      </h3>
                      <p>
                        {selectedResult.auditClause.auditId} ·{" "}
                        {selectedResult.auditClause.level} · 维度{" "}
                        {selectedResult.auditClause.dimension || "-"} · 分值{" "}
                        {selectedResult.auditClause.score ?? "-"}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                      <p className="text-xs font-medium tracking-wide text-gray-500">
                        推荐结果
                      </p>
                      {selectedResult.bestMatch ? (
                        <div className="mt-3 space-y-2">
                          <p className="font-medium text-gray-900">
                            {selectedResult.bestMatch.consensusId}｜
                            {selectedResult.bestMatch.title}
                          </p>
                          <p>
                            类型 {selectedResult.bestMatch.type || "-"} · clauseId{" "}
                            {selectedResult.bestMatch.clauseId || "-"}
                          </p>
                          <p className="text-sm text-slate-600">
                            {selectedResult.bestMatch.contentText || "暂无共识正文"}
                          </p>
                          <p className="text-xs text-gray-500">
                            关键词分 {selectedResult.bestMatch.keywordScore.toFixed(2)}
                            {selectedResult.bestMatch.semanticScore !== null
                              ? ` · 语义分 ${selectedResult.bestMatch.semanticScore.toFixed(2)}`
                              : ""}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-gray-500">
                          当前未找到可信共识候选。
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    请先从左侧列表中选择一条分析结果。
                  </p>
                )}
              </WorkspaceSection>

              <WorkspaceSection
                title="判断理由与候选"
                description="解释性内容保留，但放到右侧详情区集中查看。"
              >
                {selectedResult ? (
                  <div className="space-y-4 text-sm text-gray-700">
                    <div>
                      <p className="font-medium text-gray-900">判断理由</p>
                      <div className="mt-2 space-y-1 text-slate-600">
                        {selectedResult.reasons.map((reason) => (
                          <p key={`${selectedResult.auditKey}-${reason}`}>{reason}</p>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">候选列表</p>
                      <div className="mt-2 space-y-2">
                        {selectedResult.candidates.slice(0, 4).map((candidate) => (
                          <div
                            key={`${selectedResult.auditKey}-${candidate.consensusId}`}
                            className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-600 ring-1 ring-slate-200"
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
                ) : (
                  <p className="text-sm text-gray-500">暂无候选详情可展示。</p>
                )}
              </WorkspaceSection>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
