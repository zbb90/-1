/**
 * 一次性在线迁移：把 rules 表里「不是真稽核条款」的答疑沉淀行迁到 FAQ 沉积表。
 *
 * 三表语义（用户确认）
 *   - rules（=「稽核表」）：与古茗稽核 Excel X.Y 标准条款一一对应
 *   - consensus：对稽核条款的补充解释
 *   - faq（常问沉积）：平时回答专员问题需要加进知识库的沉淀
 *
 * 判定规则（v2）
 *   - 保留在 rules：条款编号在稽核 Excel 47 个 X.Y 标准条款 ID 集合内
 *     OR tags 字段中包含 "audit-clause"（人工标白名单兜底）
 *   - 迁到 FAQ：其余所有行（含旧版「自动从稽核共识抽取」86 条已迁的、
 *     R-0136 这种「扣分 / 按场景判定」的答疑沉淀、备注里有 311/33/37 脏编号的）
 *
 * 设计原则
 *   - 数据源是 Redis（线上现状），不是仓库里的 CSV 模板
 *   - 严格幂等：FAQ 备注里若已含 `迁移自规则表 R-xxxx`，本轮跳过新增（仍从 rules 清掉）
 *   - 只动这次需要拆的行；其他 rules / FAQ 在线编辑完全保留
 *   - 不动向量库；重建仍由 /storage 现有按钮单独触发
 */

import { readRows, replaceTableRows } from "@/lib/knowledge-store";
import type { FaqRow, RuleRow } from "@/lib/types";
import { AUDIT_CLAUSE_IDS } from "./audit-clause-ids.generated";

const MIGRATION_NOTE_PREFIX = "迁移自规则表";
const KEEP_AS_AUDIT_TAG = "audit-clause";

const AUDIT_CLAUSE_ID_SET = new Set(AUDIT_CLAUSE_IDS.map((s) => s.toUpperCase()));

function isAuditClause(rule: RuleRow): boolean {
  const clauseNo = (rule.条款编号 ?? "").trim().toUpperCase();
  if (clauseNo && AUDIT_CLAUSE_ID_SET.has(clauseNo)) return true;
  const tags = (rule.tags ?? "").toLowerCase();
  return tags.split(/[|,\s]+/).includes(KEEP_AS_AUDIT_TAG);
}

export interface SplitMigrationCandidate {
  ruleId: string;
  clauseNo: string;
  clauseTitle: string;
  questionExample: string;
  consensusId: string;
  generatedFaqId: string;
  alreadyMigrated: boolean;
  reason: string; // 为什么判定为答疑沉淀
}

export interface RetainedClause {
  ruleId: string;
  clauseNo: string;
  clauseTitle: string;
  reason: string; // "audit-excel" | "tag-whitelist"
}

export interface SplitMigrationPlan {
  rulesTotal: number;
  faqTotal: number;
  retained: number; // 留在 rules 的稽核条款数
  matched: number; // 待迁的总数
  alreadyMigrated: number; // 其中已在 FAQ 中存在（仅清 rules）
  toMigrate: number; // 实际本轮要写入 FAQ 的数量
  candidates: SplitMigrationCandidate[];
  retainedClauses: RetainedClause[];
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

function reasonForMigration(rule: RuleRow): string {
  const clauseNo = (rule.条款编号 ?? "").trim();
  const upper = clauseNo.toUpperCase();
  if (!clauseNo) return "条款编号为空";
  if (!/^[A-Z]+\d+\.\d+$/.test(upper)) {
    return `条款编号 ${clauseNo} 不符合稽核 X.Y 格式`;
  }
  if (!AUDIT_CLAUSE_ID_SET.has(upper)) {
    return `条款编号 ${clauseNo} 不在稽核 Excel 47 个标准条款里`;
  }
  return "未知";
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

  const matchedRules: RuleRow[] = [];
  const retainedRules: RuleRow[] = [];
  for (const rule of rules) {
    if (isAuditClause(rule)) {
      retainedRules.push(rule);
    } else {
      matchedRules.push(rule);
    }
  }

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
      reason: reasonForMigration(rule),
    };
  });

  const retainedClauses: RetainedClause[] = retainedRules.map((rule) => {
    const clauseNo = (rule.条款编号 ?? "").trim().toUpperCase();
    const fromExcel = AUDIT_CLAUSE_ID_SET.has(clauseNo);
    return {
      ruleId: rule.rule_id,
      clauseNo: rule.条款编号 ?? "",
      clauseTitle: rule.条款标题 ?? "",
      reason: fromExcel ? "audit-excel" : "tag-whitelist",
    };
  });

  const plan: SplitMigrationPlan = {
    rulesTotal: rules.length,
    faqTotal: faq.length,
    retained: retainedRules.length,
    matched: matchedRules.length,
    alreadyMigrated: candidates.filter((c) => c.alreadyMigrated).length,
    toMigrate: candidates.filter((c) => !c.alreadyMigrated).length,
    candidates,
    retainedClauses,
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
