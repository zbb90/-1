import { readRows } from "@/lib/knowledge-store";
import { upsertRuleVectors } from "@/lib/vector-store";
import { patchRowStatus, type KbTableName } from "@/lib/knowledge-csv";
import type {
  ConsensusRow,
  ExternalPurchaseRow,
  FaqRow,
  KnowledgeBase,
  OperationRow,
  OldItemRow,
  ProductionCheckRow,
  RuleRow,
} from "@/lib/types";

const TABLE_TTL_MS = 60_000;

interface TableCacheEntry<T> {
  rows: T[];
  expireAt: number;
}

const tableCache = new Map<KbTableName, TableCacheEntry<unknown>>();

let knowledgeBaseCache: KnowledgeBase | null = null;
let pendingSyncRunning = false;

export function invalidateKnowledgeBaseCache() {
  knowledgeBaseCache = null;
  tableCache.clear();
}

export function invalidateKnowledgeTableCache(name: KbTableName) {
  tableCache.delete(name);
  // 任一表变化会让聚合视图失效，避免数据不一致。
  knowledgeBaseCache = null;
}

function isFreshEntry<T>(entry: TableCacheEntry<T> | undefined, now: number) {
  return Boolean(entry && entry.expireAt > now);
}

type RowWithStatus = { 状态?: string };

const FILTERS: Record<KbTableName, (row: RowWithStatus) => boolean> = {
  rules: (row) => row.状态 !== "停用" && row.状态 !== "待向量同步",
  consensus: (row) => row.状态 !== "停用",
  "external-purchases": (row) => row.状态 !== "停用",
  "old-items": (row) => row.状态 !== "停用",
  operations: (row) => row.状态 !== "停用",
  "production-checks": (row) => row.状态 !== "停用",
  faq: (row) => row.状态 !== "停用",
};

export async function loadKnowledgeTable<T>(name: KbTableName): Promise<T[]> {
  const now = Date.now();
  const entry = tableCache.get(name) as TableCacheEntry<T> | undefined;
  if (isFreshEntry(entry, now)) {
    return entry!.rows;
  }

  const raw = (await readRows(name)) as unknown as T[];
  const filterFn = FILTERS[name];
  const rows = filterFn
    ? raw.filter((row) => filterFn(row as unknown as RowWithStatus))
    : raw;
  tableCache.set(name, {
    rows: rows as unknown[],
    expireAt: now + TABLE_TTL_MS,
  });

  if (name === "rules") {
    catchUpPendingVectorSync(raw as unknown as RuleRow[]).catch(() => {});
  }

  return rows;
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
      invalidateKnowledgeBaseCache();
    }
  } catch (err) {
    console.warn("[vector-catchup] failed", err);
  } finally {
    pendingSyncRunning = false;
  }
}

export async function loadKnowledgeBase(forceRefresh = false): Promise<KnowledgeBase> {
  if (knowledgeBaseCache && !forceRefresh) {
    return knowledgeBaseCache;
  }
  if (forceRefresh) {
    tableCache.clear();
  }

  const [
    rules,
    consensus,
    externalPurchases,
    oldItems,
    operations,
    productionChecks,
    faq,
  ] = await Promise.all([
    loadKnowledgeTable<RuleRow>("rules"),
    loadKnowledgeTable<ConsensusRow>("consensus"),
    loadKnowledgeTable<ExternalPurchaseRow>("external-purchases"),
    loadKnowledgeTable<OldItemRow>("old-items"),
    loadKnowledgeTable<OperationRow>("operations"),
    loadKnowledgeTable<ProductionCheckRow>("production-checks"),
    loadKnowledgeTable<FaqRow>("faq"),
  ]);

  knowledgeBaseCache = {
    rules,
    consensus,
    externalPurchases,
    oldItems,
    operations,
    productionChecks,
    faq,
  };

  return knowledgeBaseCache;
}

export async function getKnowledgeSummary() {
  const knowledgeBase = await loadKnowledgeBase();
  return {
    rules: knowledgeBase.rules.length,
    consensus: knowledgeBase.consensus.length,
    externalPurchases: knowledgeBase.externalPurchases.length,
    oldItems: knowledgeBase.oldItems.length,
    operations: knowledgeBase.operations.length,
    productionChecks: knowledgeBase.productionChecks.length,
    faq: knowledgeBase.faq.length,
    templateDir: "Redis / CSV",
  };
}
