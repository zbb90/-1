"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  StatusPill,
  WorkspaceActionButton,
  WorkspaceMetric,
  WorkspacePill,
  WorkspaceSection,
} from "@/components/admin/knowledge-workspace";

type SuggestionStatus = "pending" | "approved" | "rejected" | "skipped";
type LinkType = "references" | "supports" | "related" | "supersedes" | "contradicts";
type KbTable =
  | "rules"
  | "consensus"
  | "external-purchases"
  | "old-items"
  | "operations"
  | "production-checks"
  | "faq";

type SuggestionItem = {
  id: string;
  sourceTable: KbTable;
  sourceId: string;
  targetTable: KbTable;
  targetId: string;
  linkType: LinkType;
  confidence: number;
  reason: string;
  evidenceSourceSpan: string;
  evidenceTargetSpan: string;
  model: string;
  status: SuggestionStatus;
  createdAt: string;
  updatedAt: string;
  decidedBy?: string;
  decidedAt?: string;
};

type Stats = Record<SuggestionStatus, number>;

const TABLE_LABEL: Record<KbTable, string> = {
  rules: "规则",
  consensus: "共识",
  "external-purchases": "外购",
  "old-items": "旧品",
  operations: "操作",
  "production-checks": "出品检查",
  faq: "FAQ",
};

const LINK_TYPE_LABEL: Record<LinkType, string> = {
  references: "引用",
  supports: "支撑",
  related: "一般关联",
  supersedes: "替代",
  contradicts: "冲突",
};

const STATUS_LABEL: Record<SuggestionStatus, string> = {
  pending: "待审核",
  approved: "已采纳",
  rejected: "已拒绝",
  skipped: "已跳过",
};

function formatDateLabel(value: string) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AiSuggestionsView() {
  const [status, setStatus] = useState<SuggestionStatus | "all">("pending");
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [stats, setStats] = useState<Stats>({
    pending: 0,
    approved: 0,
    rejected: 0,
    skipped: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanDryRun, setScanDryRun] = useState<null | {
    totalCandidates: number;
    deterministicPairs: number;
    estimatedLlmCalls: number;
    skippedByBlocklist: number;
    skippedByExisting: number;
    skippedByPending: number;
    warnings: string[];
    elapsedMs: number;
  }>(null);
  const [scanMsg, setScanMsg] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const url = `/api/knowledge/links/suggestions?status=${encodeURIComponent(status)}&limit=200&t=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setItems((json.data?.items ?? []) as SuggestionItem[]);
        if (json.data?.stats) setStats(json.data.stats as Stats);
      } else {
        setError(json.message || "读取建议失败");
        setItems([]);
      }
    } catch {
      setError("网络错误，无法读取 AI 关联建议。");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const triggerScan = useCallback(
    async (dryRun: boolean) => {
      setScanning(true);
      setScanMsg("");
      setScanDryRun(null);
      try {
        const res = await fetch("/api/knowledge/links/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun }),
        });
        const json = await res.json();
        if (!json.ok && !json.data) {
          setScanMsg(json.message || "触发扫描失败");
          return;
        }
        const data = json.data;
        if (dryRun) {
          setScanDryRun({
            totalCandidates: data.totalCandidates,
            deterministicPairs: data.deterministicPairs ?? 0,
            estimatedLlmCalls: data.estimatedLlmCalls,
            skippedByBlocklist: data.skippedByBlocklist,
            skippedByExisting: data.skippedByExisting,
            skippedByPending: data.skippedByPending,
            warnings: data.warnings ?? [],
            elapsedMs: data.elapsedMs,
          });
          setScanMsg(
            `预估将调用 LLM ${data.estimatedLlmCalls} 次，规则型强关联 ${
              data.deterministicPairs ?? 0
            } 对，已过滤 ${
              data.skippedByExisting + data.skippedByPending + data.skippedByBlocklist
            } 对。确认后点击「执行扫描」。`,
          );
        } else {
          setScanMsg(
            `扫描完成：新增 ${data.added} 条待审建议（规则型 ${
              data.deterministicPairs ?? 0
            } 对，LLM 判定 ${data.judgedPairs} 对，拒绝 ${data.rejectedByLlm} 对，用时 ${
              Math.round(data.elapsedMs / 100) / 10
            }s）。`,
          );
          setScanDryRun(null);
          await fetchList();
        }
      } catch {
        setScanMsg("网络错误，触发扫描失败。");
      } finally {
        setScanning(false);
      }
    },
    [fetchList],
  );

  const act = useCallback(
    async (id: string, action: "approve" | "reject" | "skip") => {
      setActionId(id);
      try {
        const res = await fetch(`/api/knowledge/links/suggestions/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const json = await res.json();
        if (!json.ok) {
          if (res.status === 409) {
            await fetchList();
            alert(`${json.message || "该建议状态已变化。"}页面已刷新。`);
            return;
          }
          alert(json.message || "处理建议失败");
          return;
        }
        await fetchList();
      } catch {
        alert("网络错误，处理建议失败");
      } finally {
        setActionId(null);
      }
    },
    [fetchList],
  );

  const filtered = useMemo(() => items, [items]);

  return (
    <div className="space-y-5">
      <WorkspaceSection
        title="AI 关联建议总览"
        description="模型根据向量相似度与原文证据产出的关联候选；采纳后会作为 source=ai 的正式连线，拒绝后该配对不再出现。"
        actions={
          <div className="flex flex-wrap gap-2">
            <WorkspaceActionButton
              outline
              onClick={() => triggerScan(true)}
              disabled={scanning}
            >
              {scanning ? "扫描中..." : "预估本次成本"}
            </WorkspaceActionButton>
            <WorkspaceActionButton
              tone="amber"
              onClick={() => triggerScan(false)}
              disabled={scanning}
            >
              {scanning ? "扫描中..." : "执行扫描"}
            </WorkspaceActionButton>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <WorkspaceMetric label="待审核" value={stats.pending} tone="amber" />
          <WorkspaceMetric label="已采纳" value={stats.approved} tone="green" />
          <WorkspaceMetric label="已拒绝" value={stats.rejected} tone="red" />
          <WorkspaceMetric label="已跳过" value={stats.skipped} tone="slate" />
        </div>
        {scanMsg ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-amber-200">
            {scanMsg}
          </p>
        ) : null}
        {scanDryRun ? (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <WorkspaceMetric label="候选对总数" value={scanDryRun.totalCandidates} />
            <WorkspaceMetric
              label="预估 LLM 调用"
              value={scanDryRun.estimatedLlmCalls}
              tone="amber"
            />
            <WorkspaceMetric
              label="规则型强关联"
              value={scanDryRun.deterministicPairs}
              tone="green"
            />
            <WorkspaceMetric
              label="已跳过（已存在/待审/blocklist）"
              value={
                scanDryRun.skippedByExisting +
                scanDryRun.skippedByPending +
                scanDryRun.skippedByBlocklist
              }
              tone="slate"
              meta={`blocklist ${scanDryRun.skippedByBlocklist}`}
            />
            <WorkspaceMetric
              label="预计耗时"
              value={`${Math.max(1, Math.ceil(scanDryRun.estimatedLlmCalls / 4))}s~`}
              tone="blue"
              meta={`dryRun ${Math.round(scanDryRun.elapsedMs)}ms`}
            />
          </div>
        ) : null}
      </WorkspaceSection>

      <WorkspaceSection
        title="建议列表"
        description="按置信度倒序。点击条目可展开 LLM 原文证据。"
        actions={
          <div className="flex flex-wrap gap-1.5">
            {(
              ["pending", "approved", "rejected", "skipped", "all"] as Array<
                SuggestionStatus | "all"
              >
            ).map((key) => (
              <WorkspacePill
                key={key}
                active={status === key}
                onClick={() => setStatus(key)}
              >
                {key === "all" ? "全部" : STATUS_LABEL[key]}
              </WorkspacePill>
            ))}
          </div>
        }
      >
        {loading ? (
          <p className="text-sm text-gray-500">加载中...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500">
            当前筛选范围内没有建议。可以尝试点击右上角「执行扫描」让模型去发现新关联。
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((item) => {
              const expanded = expandedId === item.id;
              const confPct = (item.confidence * 100).toFixed(0);
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-gray-100 bg-white shadow-sm ring-1 ring-gray-100"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                    className="flex w-full flex-col gap-2 px-4 py-3 text-left md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                      <StatusPill tone="slate">
                        {TABLE_LABEL[item.sourceTable]}｜{item.sourceId}
                      </StatusPill>
                      <span className="text-xs text-gray-400">→</span>
                      <StatusPill tone="slate">
                        {TABLE_LABEL[item.targetTable]}｜{item.targetId}
                      </StatusPill>
                      <StatusPill tone="blue">
                        {LINK_TYPE_LABEL[item.linkType]}
                      </StatusPill>
                      <StatusPill
                        tone={
                          item.confidence >= 0.8
                            ? "green"
                            : item.confidence >= 0.6
                              ? "amber"
                              : "slate"
                        }
                      >
                        置信 {confPct}%
                      </StatusPill>
                      <StatusPill
                        tone={
                          item.status === "pending"
                            ? "amber"
                            : item.status === "approved"
                              ? "green"
                              : item.status === "rejected"
                                ? "red"
                                : "slate"
                        }
                      >
                        {STATUS_LABEL[item.status]}
                      </StatusPill>
                    </div>
                    <span className="text-xs text-gray-400">
                      {formatDateLabel(item.createdAt)}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="space-y-3 border-t border-gray-100 px-4 py-3">
                      <p className="text-sm text-gray-700">
                        {item.reason || "LLM 未给出具体理由。"}
                      </p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200">
                          <p className="text-xs font-medium text-slate-500">
                            源原文证据｜{item.sourceId}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">
                            {item.evidenceSourceSpan || "-"}
                          </p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200">
                          <p className="text-xs font-medium text-slate-500">
                            目标原文证据｜{item.targetId}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">
                            {item.evidenceTargetSpan || "-"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                        <span>模型：{item.model || "-"}</span>
                        {item.decidedBy ? (
                          <span>
                            {STATUS_LABEL[item.status]} · {item.decidedBy} ·{" "}
                            {formatDateLabel(item.decidedAt ?? "")}
                          </span>
                        ) : null}
                      </div>
                      {item.status === "pending" ? (
                        <div className="flex flex-wrap gap-2">
                          <WorkspaceActionButton
                            tone="green"
                            onClick={() => act(item.id, "approve")}
                            disabled={actionId === item.id}
                          >
                            采纳并建立关联
                          </WorkspaceActionButton>
                          <WorkspaceActionButton
                            tone="red"
                            outline
                            onClick={() => act(item.id, "reject")}
                            disabled={actionId === item.id}
                          >
                            拒绝并加入屏蔽
                          </WorkspaceActionButton>
                          <WorkspaceActionButton
                            tone="slate"
                            outline
                            onClick={() => act(item.id, "skip")}
                            disabled={actionId === item.id}
                          >
                            暂不处理
                          </WorkspaceActionButton>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </WorkspaceSection>
    </div>
  );
}
