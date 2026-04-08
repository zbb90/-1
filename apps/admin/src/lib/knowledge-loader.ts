import { readRows } from "@/lib/knowledge-store";
import type {
  ConsensusRow,
  ExternalPurchaseRow,
  KnowledgeBase,
  OperationRow,
  OldItemRow,
  RuleRow,
} from "@/lib/types";

let cache: KnowledgeBase | null = null;

export function invalidateKnowledgeBaseCache() {
  cache = null;
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

  cache = {
    rules: rules.filter((item) => item.状态 !== "停用"),
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
