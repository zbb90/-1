"use client";

import { useEffect, useState } from "react";
import { WorkspaceActionButton } from "@/components/admin/knowledge-workspace";

interface DupCandidate {
  faqId: string;
  question: string;
  rawConsensusId: string;
  resolvedConsensusId: string;
  consensusTitle: string;
  reason: string;
}

interface OrphanRow {
  faqId: string;
  question: string;
  rawConsensusId: string;
  reason: string;
}

interface RetainedRow {
  faqId: string;
  question: string;
  source: string;
  reviewId: string;
  reason: string;
}

interface Plan {
  faqTotal: number;
  consensusTotal: number;
  toDelete: number;
  orphans: number;
  retained: number;
  duplicates: DupCandidate[];
  orphanRows: OrphanRow[];
  retainedRows: RetainedRow[];
}

const ENDPOINT = "/api/admin/migrations/clean-faq-consensus-dups";

export function CleanFaqDupsPanel() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  async function loadPlan() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; plan?: Plan; message?: string };
      if (!data.ok || !data.plan) throw new Error(data.message || "预览失败");
      setPlan(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPlan();
  }, []);

  async function handleApply() {
    if (!plan) return;
    if (plan.toDelete === 0) {
      setApplyMessage("没有需要清理的冗余共识。");
      return;
    }
    const ok = window.confirm(
      `本次将从 FAQ 中删除 ${plan.toDelete} 条「关联共识在 consensus 表中已有原版」的冗余行。\n\nFAQ ${plan.faqTotal} → ${plan.faqTotal - plan.toDelete}\n保留真答疑沉淀 ${plan.retained} 条；孤儿 ${plan.orphans} 条不动等人工。\n\n该操作仅写 Redis、不影响向量库，是否继续？`,
    );
    if (!ok) return;
    setApplying(true);
    setApplyMessage(null);
    setError(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      if (!data.ok) throw new Error(data.message || "清理失败");
      setApplyMessage(data.message || "清理成功");
      await loadPlan();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-blue-50 p-4 text-sm leading-6 text-blue-800 ring-1 ring-blue-200">
        <p className="font-medium">
          FAQ 清理：把「其实是共识副本」的行从常问沉积里删掉。
        </p>
        <p className="mt-1">
          <b>判定规则</b>：FAQ 行的 关联共识编号 归一化（含{" "}
          <code>C-xxxx → CS-xxxx</code> 自动修复笔误）后能在 consensus 表里查到 →
          是冗余（共识原版还在），删除。
        </p>
        <p className="mt-1">
          <b>不动</b>：关联共识编号 为空（真答疑沉淀） / 关联共识编号 在 consensus
          找不到（孤儿，列出供人工处理）。
        </p>
        <p className="mt-1">
          建议执行顺序：① 先点上面的「rules → FAQ 一次性迁移」把 R-0136 等真答疑迁过来 ②
          再点本面板「执行清理」清掉历史共识冗余 ③ 最后点「重建知识向量库」。
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      ) : null}

      {applyMessage ? (
        <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700 ring-1 ring-green-200">
          {applyMessage}
        </div>
      ) : null}

      {loading && !plan ? (
        <p className="text-sm text-slate-500">正在读取线上 Redis 现状…</p>
      ) : null}

      {plan ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="FAQ 当前总数" value={plan.faqTotal} />
            <Stat label="consensus 总数" value={plan.consensusTotal} />
            <Stat label="待清理冗余" value={plan.toDelete} tone="red" />
            <Stat label="孤儿（人工）" value={plan.orphans} tone="amber" />
            <Stat label="保留真答疑" value={plan.retained} tone="green" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <WorkspaceActionButton
              type="button"
              tone="slate"
              outline
              onClick={loadPlan}
              disabled={loading}
            >
              {loading ? "刷新中…" : "刷新预览"}
            </WorkspaceActionButton>
            <WorkspaceActionButton
              type="button"
              tone="green"
              onClick={handleApply}
              disabled={applying || plan.toDelete === 0}
            >
              {applying
                ? "执行中…"
                : plan.toDelete === 0
                  ? "没有冗余可清理"
                  : `执行清理（删除 ${plan.toDelete} 条）`}
            </WorkspaceActionButton>
          </div>

          {plan.duplicates.length > 0 ? (
            <details open className="rounded-2xl ring-1 ring-red-100">
              <summary className="cursor-pointer rounded-t-2xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
                待清理冗余清单（{plan.duplicates.length} 条）
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-medium uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">faq_id</th>
                      <th className="px-3 py-2">问题</th>
                      <th className="px-3 py-2">关联共识</th>
                      <th className="px-3 py-2">consensus 标题</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {plan.duplicates.map((d) => (
                      <tr key={d.faqId}>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">
                          {d.faqId}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{d.question}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          <span className="font-mono text-slate-600">
                            {d.resolvedConsensusId}
                          </span>
                          {d.rawConsensusId !== d.resolvedConsensusId ? (
                            <span className="ml-1 text-amber-600">
                              (修复自 {d.rawConsensusId})
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {d.consensusTitle}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          {plan.orphanRows.length > 0 ? (
            <details className="rounded-2xl ring-1 ring-amber-200">
              <summary className="cursor-pointer rounded-t-2xl bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800">
                孤儿（{plan.orphanRows.length} 条）—— 关联共识编号在 consensus
                查不到，本工具不动
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-medium uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">faq_id</th>
                      <th className="px-3 py-2">问题</th>
                      <th className="px-3 py-2">关联共识</th>
                      <th className="px-3 py-2">说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {plan.orphanRows.map((o) => (
                      <tr key={o.faqId}>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">
                          {o.faqId}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{o.question}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-amber-700">
                          {o.rawConsensusId}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">{o.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          {plan.retainedRows.length > 0 ? (
            <details className="rounded-2xl ring-1 ring-green-200">
              <summary className="cursor-pointer rounded-t-2xl bg-green-50 px-4 py-2 text-sm font-medium text-green-800">
                保留的真答疑沉淀（{plan.retainedRows.length} 条）
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-medium uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">faq_id</th>
                      <th className="px-3 py-2">问题</th>
                      <th className="px-3 py-2">沉积来源</th>
                      <th className="px-3 py-2">review_id</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {plan.retainedRows.map((r) => (
                      <tr key={r.faqId}>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">
                          {r.faqId}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{r.question}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                          {r.source || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                          {r.reviewId || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "green" | "amber" | "red";
}) {
  const toneClass = {
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
    green: "bg-green-50 text-green-700 ring-green-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    red: "bg-red-50 text-red-700 ring-red-200",
  }[tone];
  return (
    <div className={`rounded-2xl px-4 py-3 ring-1 ${toneClass}`}>
      <p className="text-xs font-medium tracking-wide opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
