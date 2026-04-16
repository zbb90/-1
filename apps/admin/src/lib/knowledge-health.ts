import { listKnowledgeLinks } from "@/lib/knowledge-links";
import { readRows } from "@/lib/knowledge-store";
import { listReviewTasks } from "@/lib/review-pool";
import type { ReviewTask } from "@/lib/types";

type RuleHealthItem = {
  ruleId: string;
  clauseNo: string;
  clauseTitle: string;
  hitCount: number;
  lastHitAt: string;
  hasConsensusSource: boolean;
  linkCount: number;
};

type ParsedTaskPayload = {
  autoAnswer?: {
    ruleId?: string;
  };
};

function parseTaskPayload(task: ReviewTask): ParsedTaskPayload | null {
  try {
    return JSON.parse(task.sourcePayload) as ParsedTaskPayload;
  } catch {
    return null;
  }
}

function daysAgo(days: number) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function sortByHits(items: RuleHealthItem[]) {
  return [...items].sort((a, b) => {
    if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
    return a.ruleId.localeCompare(b.ruleId);
  });
}

export async function getKnowledgeHealthReport() {
  const [rules, links, tasks] = await Promise.all([
    readRows("rules"),
    listKnowledgeLinks(),
    listReviewTasks(),
  ]);

  const ruleLinkCount = new Map<string, number>();
  for (const link of links) {
    if (link.sourceTable === "rules") {
      ruleLinkCount.set(link.sourceId, (ruleLinkCount.get(link.sourceId) ?? 0) + 1);
    }
    if (link.targetTable === "rules") {
      ruleLinkCount.set(link.targetId, (ruleLinkCount.get(link.targetId) ?? 0) + 1);
    }
  }

  const hitMap = new Map<string, { count: number; lastHitAt: string }>();
  const recentHitSet = new Set<string>();
  const recentWindow = daysAgo(30);

  for (const task of tasks) {
    const payload = parseTaskPayload(task);
    const ruleId = payload?.autoAnswer?.ruleId?.trim();
    if (!ruleId) continue;

    const createdAt = task.createdAt || "";
    const current = hitMap.get(ruleId) ?? { count: 0, lastHitAt: "" };
    current.count += 1;
    if (createdAt && createdAt > current.lastHitAt) {
      current.lastHitAt = createdAt;
    }
    hitMap.set(ruleId, current);

    const hitTime = Date.parse(createdAt);
    if (Number.isFinite(hitTime) && hitTime >= recentWindow) {
      recentHitSet.add(ruleId);
    }
  }

  const ruleItems: RuleHealthItem[] = rules.map((row) => {
    const ruleId = row.rule_id?.trim() || "";
    const hit = hitMap.get(ruleId);
    return {
      ruleId,
      clauseNo: row["条款编号"]?.trim() || "-",
      clauseTitle: row["条款标题"]?.trim() || "-",
      hitCount: hit?.count ?? 0,
      lastHitAt: hit?.lastHitAt ?? "",
      hasConsensusSource: Boolean(row["共识来源"]?.trim()),
      linkCount: ruleLinkCount.get(ruleId) ?? 0,
    };
  });

  const totalRules = ruleItems.length;
  const rulesWithConsensus = ruleItems.filter((item) => item.hasConsensusSource).length;
  const linkedRules = ruleItems.filter((item) => item.linkCount > 0).length;
  const activeRules30d = recentHitSet.size;

  const orphanRules = ruleItems.filter((item) => item.linkCount === 0 && !item.hasConsensusSource);
  const consensusGapRules = ruleItems.filter((item) => !item.hasConsensusSource);
  const coldRules = ruleItems.filter((item) => item.hitCount === 0);
  const highTrafficWithoutConsensus = ruleItems.filter(
    (item) => item.hitCount > 0 && !item.hasConsensusSource,
  );

  return {
    summary: {
      totalRules,
      rulesWithConsensus,
      consensusCoveragePct: totalRules > 0 ? Math.round((rulesWithConsensus / totalRules) * 100) : 0,
      linkedRules,
      linkCoveragePct: totalRules > 0 ? Math.round((linkedRules / totalRules) * 100) : 0,
      orphanRules: orphanRules.length,
      activeRules30d,
      activeRules30dPct: totalRules > 0 ? Math.round((activeRules30d / totalRules) * 100) : 0,
      coldRules: coldRules.length,
    },
    topHitRules: sortByHits(ruleItems).slice(0, 10),
    orphanRules: sortByHits(orphanRules).slice(0, 10),
    consensusGapRules: sortByHits(consensusGapRules).slice(0, 10),
    coldRules: sortByHits(coldRules).slice(0, 10),
    highTrafficWithoutConsensus: sortByHits(highTrafficWithoutConsensus).slice(0, 10),
  };
}
