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
}

interface Plan {
  rulesTotal: number;
  faqTotal: number;
  matched: number;
  alreadyMigrated: number;
  toMigrate: number;
  candidates: Candidate[];
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
    if (plan.toMigrate === 0) {
      setApplyMessage("没有待迁移条目，所有命中行都已在 FAQ 表里。");
      return;
    }
    const ok = window.confirm(
      `本次将把 ${plan.toMigrate} 条 rules 行写入 FAQ，并从 rules 表物理删除（含已迁过的 ${plan.alreadyMigrated} 条幂等清理）。该操作仅写 Redis、不影响向量库，是否继续？`,
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
          一次性迁移：把 rules 中「自动从稽核共识抽取」拆到 FAQ。
        </p>
        <p className="mt-1">
          只动这 86 条历史共识行，其他在线编辑过的 rules / FAQ 一概不碰。幂等：
          重复点击不会出脏数据；如果 FAQ 备注里已含 `迁移自规则表 R-xxxx`
          会自动跳过该条。
        </p>
        <p className="mt-1">
          执行后 <b>必须</b> 单独点上面的「重建知识向量库（规则 + 共识 + FAQ）」按钮，
          线上的 AI 回答才会改用 FAQ 直答。
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="rules 当前总数" value={plan.rulesTotal} />
            <Stat label="faq 当前总数" value={plan.faqTotal} />
            <Stat label="命中迁移条件" value={plan.matched} tone="amber" />
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
                    <th className="px-3 py-2">关联共识</th>
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
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                        {c.consensusId || "—"}
                      </td>
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
              当前 Redis rules 表中没有以「自动从稽核共识抽取」开头备注的行。
            </p>
          )}
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
