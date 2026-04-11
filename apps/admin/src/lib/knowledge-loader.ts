import { readRows } from "@/lib/knowledge-store";
import { upsertRuleVectors } from "@/lib/vector-store";
import { patchRowStatus } from "@/lib/knowledge-csv";
import type {
  ConsensusRow,
  ExternalPurchaseRow,
  KnowledgeBase,
  OperationRow,
  OldItemRow,
  RuleRow,
} from "@/lib/types";

let cache: KnowledgeBase | null = null;
let pendingSyncRunning = false;

export function invalidateKnowledgeBaseCache() {
  cache = null;
}

async function catchUpPendingVectorSync(allRules: RuleRow[]) {
  if (pendingSyncRunning) return;
  const pending = allRules.filter((r) => r.状态 === "待向量同步");
  if (pending.length === 0) return;

  pendingSyncRunning = true;
  try {
    const result = await upsertRuleVectors(pending);
    if (result.ok) {
      for (const rule of pending) {
        await patchRowStatus("rules", rule.rule_id, "启用");
      }
      console.info(`[vector-catchup] synced ${pending.length} pending rules`);
      cache = null;
    }
  } catch (err) {
    console.warn("[vector-catchup] failed", err);
  } finally {
    pendingSyncRunning = false;
  }
}

export async function loadKnowledgeBase(forceRefresh = false) {
  if (cache && !forceRefresh) {
    return cache;
  }

  const [rules, consensus, externalPurchases, oldItems, operations] = await Promise.all(
    [
      readRows("rules") as Promise<unknown> as Promise<RuleRow[]>,
      readRows("consensus") as Promise<unknown> as Promise<ConsensusRow[]>,
      readRows("external-purchases") as Promise<unknown> as Promise<
        ExternalPurchaseRow[]
      >,
      readRows("old-items") as Promise<unknown> as Promise<OldItemRow[]>,
      readRows("operations") as Promise<unknown> as Promise<OperationRow[]>,
    ],
  );

  catchUpPendingVectorSync(rules).catch(() => {});

  cache = {
    rules: rules.filter((item) => item.状态 !== "停用" && item.状态 !== "待向量同步"),
    consensus: consensus.filter((item) => item.状态 !== "停用"),
    externalPurchases: externalPurchases.filter((item) => item.状态 !== "停用"),
    oldItems: oldItems.filter((item) => item.状态 !== "停用"),
    operations: operations.filter((item) => item.状态 !== "停用"),
  };

  return cache;
}

export async function getKnowledgeSummary() {
  const knowledgeBase = await loadKnowledgeBase();
  return {
    rules: knowledgeBase.rules.length,
    consensus: knowledgeBase.consensus.length,
    externalPurchases: knowledgeBase.externalPurchases.length,
    oldItems: knowledgeBase.oldItems.length,
    operations: knowledgeBase.operations.length,
    templateDir: "Redis / CSV",
  };
}
