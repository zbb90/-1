"use client";

import { useEffect, useState } from "react";
import { WorkspaceActionButton } from "@/components/admin/knowledge-workspace";

interface Candidate {
  ruleId: string;
  clauseNo: string;
  clauseTitle: string;
  questionExample: string;
  consensusId: string;
  generatedFaqId: string;
  alreadyMigrated: boolean;
  reason: string;
}

interface RetainedClause {
  ruleId: string;
  clauseNo: string;
  clauseTitle: string;
  reason: string;
}

interface Plan {
  rulesTotal: number;
  faqTotal: number;
  retained: number;
  matched: number;
  alreadyMigrated: number;
  toMigrate: number;
  candidates: Candidate[];
  retainedClauses: RetainedClause[];
}

interface ApplyResult extends Plan {
  applied: true;
  faqAfter: number;
  rulesAfter: number;
  removedRuleIds: string[];
  insertedFaqIds: string[];
}

const ENDPOINT = "/api/admin/migrations/split-rules-to-faq";

export function SplitRulesMigrationPanel() {
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
      if (!data.ok || !data.plan) {
        throw new Error(data.message || "预览失败");
      }
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
    if (plan.toMigrate === 0 && plan.alreadyMigrated === 0) {
      setApplyMessage("没有需要处理的条目：所有非稽核条款都已迁过且已从 rules 清掉。");
      return;
    }
    const ok = window.confirm(
      `本次将把 ${plan.toMigrate} 条非稽核条款写入 FAQ，并从 rules 表物理删除 ${plan.matched} 条（含已迁过的 ${plan.alreadyMigrated} 条幂等清理）。\n\nrules 将保留 ${plan.retained} 条真稽核条款。\n\n该操作仅写 Redis、不影响向量库，是否继续？`,
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
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        result?: ApplyResult;
      };
      if (!data.ok) throw new Error(data.message || "迁移失败");
      setApplyMessage(data.message || "迁移成功");
      await loadPlan();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-800 ring-1 ring-amber-200">
        <p className="font-medium">
          一次性迁移：把 rules 中「不是真稽核条款」的答疑沉淀拆到 FAQ。
        </p>
        <p className="mt-1">
          <b>判定规则</b>：rules 只保留条款编号在古茗稽核 Excel 47 个 X.Y 标准条款（H1.1
          / F4.1 / B2.3 …）里的行，或 tags 含 <code>audit-clause</code>{" "}
          的人工白名单条款；其他全部迁到 FAQ。
        </p>
        <p className="mt-1">
          <b>幂等</b>：FAQ 备注里已含 <code>迁移自规则表 R-xxxx</code>{" "}
          的会跳过新增（仍从 rules 清掉）；重复点击不会出脏数据。
        </p>
        <p className="mt-1">
          执行后 <b>必须</b> 单独点上面的「重建知识向量库（规则 + 共识 + FAQ）」按钮，
          线上的 AI 回答才会改用新版数据布局。
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
            <Stat label="rules 当前总数" value={plan.rulesTotal} />
            <Stat label="将保留稽核条款" value={plan.retained} tone="slate" />
            <Stat label="faq 当前总数" value={plan.faqTotal} />
            <Stat label="判定为答疑沉淀" value={plan.matched} tone="amber" />
            <Stat label="本次实际待迁" value={plan.toMigrate} tone="green" />
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
              disabled={applying || plan.toMigrate === 0}
            >
              {applying
                ? "执行中…"
                : plan.toMigrate === 0
                  ? "没有待迁条目"
                  : `执行迁移（${plan.toMigrate} 条）`}
            </WorkspaceActionButton>
          </div>

          {plan.candidates.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-200">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">rule_id</th>
                    <th className="px-3 py-2">原条款编号</th>
                    <th className="px-3 py-2">条款标题 / 示例问法</th>
                    <th className="px-3 py-2">迁移原因</th>
                    <th className="px-3 py-2">→ FAQ ID</th>
                    <th className="px-3 py-2">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {plan.candidates.map((c) => (
                    <tr key={c.ruleId}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">
                        {c.ruleId}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                        {c.clauseNo || "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        <div className="font-medium">{c.clauseTitle || "—"}</div>
                        {c.questionExample ? (
                          <div className="mt-0.5 text-xs text-slate-500">
                            {c.questionExample}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{c.reason}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">
                        {c.generatedFaqId || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {c.alreadyMigrated ? (
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-slate-600 ring-1 ring-slate-200">
                            已迁过（仅清 rules）
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-green-50 px-2 py-1 text-green-700 ring-1 ring-green-200">
                            待迁移
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              当前 Redis rules 表中所有行都已是真稽核条款，没有需要迁出的答疑沉淀。
            </p>
          )}

          <details className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              将保留在 rules 的稽核条款（{plan.retainedClauses.length} 条）
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs font-medium uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">rule_id</th>
                    <th className="px-3 py-2">条款编号</th>
                    <th className="px-3 py-2">条款标题</th>
                    <th className="px-3 py-2">来源</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {plan.retainedClauses.map((r) => (
                    <tr key={r.ruleId}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">
                        {r.ruleId}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700">
                        {r.clauseNo}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.clauseTitle || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                        {r.reason === "audit-excel"
                          ? "古茗稽核 Excel"
                          : "tags=audit-clause 白名单"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
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
  tone?: "slate" | "green" | "amber";
}) {
  const toneClass = {
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
    green: "bg-green-50 text-green-700 ring-green-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
  }[tone];
  return (
    <div className={`rounded-2xl px-4 py-3 ring-1 ${toneClass}`}>
      <p className="text-xs font-medium tracking-wide opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
