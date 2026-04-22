/**
 * 一次性在线清理：把 FAQ 沉积表里「其实是共识副本」的行删掉。
 *
 * 三表语义（用户口径）：
 *   - rules（稽核表）：47 条 X.Y 标准条款
 *   - consensus（共识解释）：对稽核条款的补充
 *   - faq（常问沉积）：平时回答专员问题的真知识沉淀
 *
 * 历史包袱：
 *   v1 把 rules 里 86 条「自动从稽核共识抽取」的共识误迁到 FAQ。
 *   这些行标题就是 "XXX 相关共识"，关联共识编号 = CS-xxxx，
 *   原版完整地在 consensus 表里。属于冗余副本，应当从 FAQ 删除。
 *
 * 判定规则
 *   - keep（不动）：关联共识编号 为空，或归一化后不在 consensus.consensus_id 集合里
 *   - delete（清理）：关联共识编号 归一化后能在 consensus 中查到（共识原版还在）
 *   - orphan（人工）：关联共识编号 非空但 consensus 中找不到
 *     —— 这种为防数据丢失，本工具不动，列出让用户人工处理
 *
 * 严格幂等：重复跑无副作用。
 */

import { readRows, replaceTableRows } from "@/lib/knowledge-store";
import type { ConsensusRow, FaqRow } from "@/lib/types";

export interface FaqDupCandidate {
  faqId: string;
  question: string;
  rawConsensusId: string;
  resolvedConsensusId: string;
  consensusTitle: string;
  reason: string;
}

export interface FaqOrphan {
  faqId: string;
  question: string;
  rawConsensusId: string;
  reason: string;
}

export interface FaqRetained {
  faqId: string;
  question: string;
  source: string; // 沉积来源
  reviewId: string;
  reason: string;
}

export interface FaqCleanPlan {
  faqTotal: number;
  consensusTotal: number;
  toDelete: number;
  orphans: number;
  retained: number;
  duplicates: FaqDupCandidate[];
  orphanRows: FaqOrphan[];
  retainedRows: FaqRetained[];
}

export interface FaqCleanApplyResult extends FaqCleanPlan {
  applied: true;
  faqAfter: number;
  deletedFaqIds: string[];
}

/** 把 FAQ.关联共识编号 归一化成 consensus.consensus_id 格式：
 *  - 去空白
 *  - 大写
 *  - C-XXXX 修复成 CS-XXXX（FAQ-0001 这种笔误）
 */
function normalizeConsensusId(raw: string | undefined | null): string {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return "";
  if (/^C-\d+$/.test(s)) return s.replace(/^C-/, "CS-");
  return s;
}

async function buildPlan(): Promise<{
  faq: FaqRow[];
  consensus: ConsensusRow[];
  plan: FaqCleanPlan;
}> {
  const [faq, consensus] = await Promise.all([
    readRows("faq") as Promise<unknown> as Promise<FaqRow[]>,
    readRows("consensus") as Promise<unknown> as Promise<ConsensusRow[]>,
  ]);

  const consensusMap = new Map(consensus.map((c) => [c.consensus_id.toUpperCase(), c]));

  const duplicates: FaqDupCandidate[] = [];
  const orphanRows: FaqOrphan[] = [];
  const retainedRows: FaqRetained[] = [];

  for (const row of faq) {
    const rawId = (row.关联共识编号 ?? "").trim();
    const normalized = normalizeConsensusId(rawId);
    if (!normalized) {
      retainedRows.push({
        faqId: row.faq_id,
        question: row.问题 ?? "",
        source: row.沉积来源 ?? "",
        reviewId: row.review_id ?? "",
        reason: "关联共识编号为空，视为真答疑沉淀",
      });
      continue;
    }
    const cs = consensusMap.get(normalized);
    if (cs) {
      duplicates.push({
        faqId: row.faq_id,
        question: row.问题 ?? "",
        rawConsensusId: rawId,
        resolvedConsensusId: normalized,
        consensusTitle: cs.标题 ?? "",
        reason:
          rawId !== normalized
            ? `关联共识编号 ${rawId} → 修复为 ${normalized}，在 consensus 表中已有原版`
            : `共识原版 ${normalized} 在 consensus 表中已存在`,
      });
    } else {
      orphanRows.push({
        faqId: row.faq_id,
        question: row.问题 ?? "",
        rawConsensusId: rawId,
        reason: `关联共识编号 ${rawId} 在 consensus 表中找不到，需人工处理`,
      });
    }
  }

  const plan: FaqCleanPlan = {
    faqTotal: faq.length,
    consensusTotal: consensus.length,
    toDelete: duplicates.length,
    orphans: orphanRows.length,
    retained: retainedRows.length,
    duplicates,
    orphanRows,
    retainedRows,
  };

  return { faq, consensus, plan };
}

export async function planFaqCleanDups(): Promise<FaqCleanPlan> {
  const { plan } = await buildPlan();
  return plan;
}

export async function applyFaqCleanDups(): Promise<FaqCleanApplyResult> {
  const { faq, plan } = await buildPlan();
  const deleteIds = new Set(plan.duplicates.map((c) => c.faqId));
  const remaining = faq.filter((row) => !deleteIds.has(row.faq_id));
  await replaceTableRows(
    "faq",
    remaining.map((row) => ({ ...row })) as unknown as Record<string, string>[],
  );
  return {
    ...plan,
    applied: true,
    faqAfter: remaining.length,
    deletedFaqIds: [...deleteIds],
  };
}
