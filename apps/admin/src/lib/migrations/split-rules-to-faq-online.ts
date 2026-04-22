/**
 * 一次性在线迁移：把 rules 表里「自动从稽核共识抽取」的历史共识行迁到 FAQ 沉积表。
 *
 * 设计原则
 *   - 数据源是 Redis（线上现状），而不是仓库里的 CSV 模板。
 *   - 严格幂等：FAQ 行的 备注 字段一旦包含 `迁移自规则表 R-xxxx`，本轮就跳过该 rule_id；
 *     这样多次点击「执行迁移」也不会出脏数据。
 *   - 只动这次需要拆出来的行；其他 rules / FAQ 行原样保留，
 *     线上对其他条目的手工编辑入口完整保留。
 *   - apply 完只动 Redis；向量库重建仍由 /storage 的「重建知识向量库」按钮单独触发。
 */

import { readRows, replaceTableRows } from "@/lib/knowledge-store";
import type { FaqRow, RuleRow } from "@/lib/types";

export const MIGRATION_REMARK_PREFIX = "自动从稽核共识抽取";
const MIGRATION_NOTE_PREFIX = "迁移自规则表";

export interface SplitMigrationCandidate {
  ruleId: string;
  clauseNo: string;
  clauseTitle: string;
  questionExample: string;
  consensusId: string;
  generatedFaqId: string;
  alreadyMigrated: boolean;
}

export interface SplitMigrationPlan {
  rulesTotal: number;
  faqTotal: number;
  matched: number; // rules 中命中迁移条件的数量
  alreadyMigrated: number; // 其中已在 FAQ 中存在
  toMigrate: number; // 实际本轮要写入 FAQ 的数量
  candidates: SplitMigrationCandidate[];
}

export interface SplitMigrationApplyResult extends SplitMigrationPlan {
  applied: true;
  faqAfter: number;
  rulesAfter: number;
  removedRuleIds: string[];
  insertedFaqIds: string[];
}

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function maxFaqSerial(rows: FaqRow[]): number {
  let max = 0;
  for (const r of rows) {
    const m = (r.faq_id ?? "").match(/FAQ-(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function isMigratedFromRule(row: FaqRow, ruleId: string): boolean {
  const haystack = `${row.备注 ?? ""} ${row.沉积来源 ?? ""}`;
  return haystack.includes(`${MIGRATION_NOTE_PREFIX} ${ruleId}`);
}

function buildFaqRow(rule: RuleRow, faqId: string, ts: string): FaqRow {
  const question = (rule.示例问法 || rule.条款标题 || "").trim();
  const answerCandidates = [rule.条款解释, rule.条款关键片段, rule.场景描述].map((v) =>
    (v ?? "").trim(),
  );
  const answer =
    answerCandidates.find((v) => v.length > 0) || (rule.条款标题 ?? "").trim();
  const keywords = (rule.问题子类或关键词 ?? "").trim();
  const oldClause = (rule.条款编号 ?? "").trim();
  const remarkParts = [
    `${MIGRATION_NOTE_PREFIX} ${rule.rule_id}`,
    oldClause ? `原条款编号=${oldClause}` : "",
    rule.问题分类 ? `分类=${rule.问题分类}` : "",
  ].filter(Boolean);

  return {
    faq_id: faqId,
    问题: question,
    答案: answer,
    // 旧 rules 上的 311/33/37 是脏数据，置空，后续走 Excel 反查
    关联条款编号: "",
    关联共识编号: (rule.共识来源 ?? "").trim(),
    review_id: "",
    沉积来源: "迁移自规则表",
    命中关键词: keywords,
    tags: ["consensus-link", "migrated-from-rules"].join("|"),
    状态: ((rule.状态 ?? "").trim() || "启用") as FaqRow["状态"],
    备注: remarkParts.join("；"),
    更新时间: ts,
  } as FaqRow;
}

async function buildPlan(): Promise<{
  rules: RuleRow[];
  faq: FaqRow[];
  plan: SplitMigrationPlan;
}> {
  const [rules, faq] = await Promise.all([
    readRows("rules") as Promise<unknown> as Promise<RuleRow[]>,
    readRows("faq") as Promise<unknown> as Promise<FaqRow[]>,
  ]);

  const matchedRules = rules.filter((r) =>
    (r.备注 ?? "").trim().startsWith(MIGRATION_REMARK_PREFIX),
  );

  let serial = maxFaqSerial(faq);
  const candidates: SplitMigrationCandidate[] = matchedRules.map((rule) => {
    const already = faq.some((row) => isMigratedFromRule(row, rule.rule_id));
    let generatedFaqId = "";
    if (!already) {
      serial += 1;
      generatedFaqId = `FAQ-${String(serial).padStart(4, "0")}`;
    } else {
      const existing = faq.find((row) => isMigratedFromRule(row, rule.rule_id));
      generatedFaqId = existing?.faq_id ?? "";
    }
    return {
      ruleId: rule.rule_id,
      clauseNo: (rule.条款编号 ?? "").trim(),
      clauseTitle: (rule.条款标题 ?? "").trim(),
      questionExample: (rule.示例问法 ?? "").trim(),
      consensusId: (rule.共识来源 ?? "").trim(),
      generatedFaqId,
      alreadyMigrated: already,
    };
  });

  const plan: SplitMigrationPlan = {
    rulesTotal: rules.length,
    faqTotal: faq.length,
    matched: matchedRules.length,
    alreadyMigrated: candidates.filter((c) => c.alreadyMigrated).length,
    toMigrate: candidates.filter((c) => !c.alreadyMigrated).length,
    candidates,
  };

  return { rules, faq, plan };
}

export async function planSplitMigration(): Promise<SplitMigrationPlan> {
  const { plan } = await buildPlan();
  return plan;
}

export async function applySplitMigration(): Promise<SplitMigrationApplyResult> {
  const { rules, faq, plan } = await buildPlan();
  const ts = nowStr();

  const removed: string[] = [];
  const inserted: string[] = [];
  const newFaqRows: FaqRow[] = [];

  for (const cand of plan.candidates) {
    if (cand.alreadyMigrated) {
      removed.push(cand.ruleId); // 已迁过的也要从 rules 删掉，避免下一轮再误进 rules
      continue;
    }
    const rule = rules.find((r) => r.rule_id === cand.ruleId);
    if (!rule) continue;
    const faqRow = buildFaqRow(rule, cand.generatedFaqId, ts);
    newFaqRows.push(faqRow);
    inserted.push(faqRow.faq_id);
    removed.push(rule.rule_id);
  }

  const remainingRules = rules.filter((r) => !removed.includes(r.rule_id));
  const nextFaq = [...faq, ...newFaqRows];

  // 按表头清洗后写回（replaceTableRows 接收 Record<string,string>，FaqRow 已是字符串字段）
  await replaceTableRows(
    "faq",
    nextFaq.map((row) => ({ ...row })) as unknown as Record<string, string>[],
  );
  await replaceTableRows(
    "rules",
    remainingRules.map((row) => ({ ...row })) as unknown as Record<string, string>[],
  );

  return {
    ...plan,
    applied: true,
    faqAfter: nextFaq.length,
    rulesAfter: remainingRules.length,
    removedRuleIds: removed,
    insertedFaqIds: inserted,
  };
}
