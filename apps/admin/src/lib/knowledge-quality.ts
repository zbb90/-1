type RuleStats = {
  retrieved: number;
  selected: number;
  rejected: number;
  lastRetrievedAt?: string;
  lastSelectedAt?: string;
};

const ruleStatsMap = new Map<string, RuleStats>();

function getOrCreate(ruleId: string): RuleStats {
  let stats = ruleStatsMap.get(ruleId);
  if (!stats) {
    stats = { retrieved: 0, selected: 0, rejected: 0 };
    ruleStatsMap.set(ruleId, stats);
  }
  return stats;
}

export function recordRetrieved(ruleIds: string[]) {
  const now = new Date().toISOString();
  for (const ruleId of ruleIds) {
    const stats = getOrCreate(ruleId);
    stats.retrieved += 1;
    stats.lastRetrievedAt = now;
  }
}

export function recordSelected(ruleId: string) {
  const stats = getOrCreate(ruleId);
  stats.selected += 1;
  stats.lastSelectedAt = new Date().toISOString();
}

export function recordRejected(ruleId: string) {
  const stats = getOrCreate(ruleId);
  stats.rejected += 1;
}

export function getKnowledgeQualityReport() {
  const entries = [...ruleStatsMap.entries()].map(([ruleId, stats]) => ({
    ruleId,
    ...stats,
    selectionRate:
      stats.retrieved > 0 ? Math.round((stats.selected / stats.retrieved) * 100) : 0,
    rejectionRate:
      stats.selected > 0 ? Math.round((stats.rejected / stats.selected) * 100) : 0,
  }));

  const lowSelectionRules = entries.filter(
    (e) => e.retrieved >= 5 && e.selectionRate < 20,
  );
  const highRejectionRules = entries.filter(
    (e) => e.selected >= 3 && e.rejectionRate > 50,
  );

  return {
    totalTrackedRules: ruleStatsMap.size,
    lowSelectionRules,
    highRejectionRules,
    allStats: entries.sort((a, b) => b.retrieved - a.retrieved),
  };
}

let unmatchedQueries: Array<{
  query: string;
  timestamp: string;
  reason?: string;
}> = [];

export function recordUnmatchedQuery(query: string, reason?: string) {
  unmatchedQueries.push({
    query,
    timestamp: new Date().toISOString(),
    reason,
  });
  if (unmatchedQueries.length > 500) {
    unmatchedQueries = unmatchedQueries.slice(-500);
  }
}

export function getUnmatchedQueries() {
  return [...unmatchedQueries];
}
