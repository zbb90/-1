import type { KbTableName } from "@/lib/kb-schema";
import { listPendingSuggestionsForGraph } from "@/lib/knowledge-link-suggestions";
import { listKnowledgeLinks } from "@/lib/link-store";
import { readRows } from "@/lib/knowledge-store";
import { normalizeTags } from "@/lib/knowledge-tags";

const DEFAULT_AI_SUGGESTION_MIN_CONFIDENCE = 0.6;

function aiSuggestionMinConfidence() {
  const raw = process.env.KB_LINK_GRAPH_MIN_CONFIDENCE?.trim();
  if (!raw) return DEFAULT_AI_SUGGESTION_MIN_CONFIDENCE;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return DEFAULT_AI_SUGGESTION_MIN_CONFIDENCE;
  return Math.max(0, Math.min(1, n));
}

export type GraphNode = {
  id: string;
  table: KbTableName;
  itemId: string;
  label: string;
  title: string;
  subtitle: string;
  summary: string;
  tags: string[];
  degree: number;
  isIsolated: boolean;
  groupLabel: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  linkType: "references" | "supports" | "related" | "supersedes" | "contradicts";
  sourceLabel: string;
  targetLabel: string;
  // "ai-suggested" 表示仍在审核池中的 AI 建议，用于图谱渲染虚线。
  sourceKind: "manual" | "derived" | "ai" | "ai-suggested";
  aiConfidence?: number;
};

const TABLES: KbTableName[] = [
  "rules",
  "consensus",
  "faq",
  "external-purchases",
  "old-items",
  "operations",
];

function idField(table: KbTableName) {
  if (table === "rules") return "rule_id";
  if (table === "consensus") return "consensus_id";
  if (table === "operations") return "op_id";
  if (table === "faq") return "faq_id";
  return "item_id";
}

function primaryField(table: KbTableName) {
  if (table === "rules") return "条款标题";
  if (table === "consensus" || table === "operations") return "标题";
  if (table === "faq") return "问题";
  return "物品名称";
}

function subtitleField(table: KbTableName) {
  if (table === "rules") return "条款编号";
  if (table === "operations") return "资料类型";
  if (table === "consensus") return "判定结果";
  if (table === "faq") return "沉积来源";
  return "";
}

function summaryField(table: KbTableName) {
  if (table === "rules") return "条款解释";
  if (table === "consensus") return "解释内容";
  if (table === "external-purchases") return "说明";
  if (table === "old-items") return "识别备注";
  if (table === "faq") return "答案";
  return "解释说明";
}

function fallbackSummaryField(table: KbTableName) {
  if (table === "rules") return "条款关键片段";
  if (table === "consensus") return "适用场景";
  if (table === "operations") return "操作内容";
  if (table === "faq") return "命中关键词";
  return "备注";
}

function groupField(table: KbTableName) {
  if (table === "rules") return "问题分类";
  if (table === "consensus") return "判定结果";
  if (table === "external-purchases") return "是否允许外购";
  if (table === "old-items") return "是否旧品";
  if (table === "faq") return "沉积来源";
  return "资料类型";
}

function normalizeText(value?: string) {
  return value?.trim() || "";
}

function truncateText(value: string, max = 120) {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trim()}...`;
}

function buildNodeLabel(table: KbTableName, row: Record<string, string>) {
  const itemId = normalizeText(row[idField(table)]) || "-";
  const primary = normalizeText(row[primaryField(table)]);
  if (table === "rules") {
    const clauseNo = normalizeText(row["条款编号"]);
    return [itemId, clauseNo, primary].filter(Boolean).join("｜");
  }
  return [itemId, primary].filter(Boolean).join("｜");
}

function buildNodeTitle(table: KbTableName, row: Record<string, string>) {
  return (
    normalizeText(row[primaryField(table)]) || normalizeText(row[idField(table)]) || "-"
  );
}

function buildNodeSubtitle(table: KbTableName, row: Record<string, string>) {
  const subtitle = subtitleField(table);
  const itemId = normalizeText(row[idField(table)]);
  return normalizeText((subtitle && row[subtitle]) || "") || itemId || "-";
}

function buildNodeSummary(table: KbTableName, row: Record<string, string>) {
  const summary =
    normalizeText(row[summaryField(table)]) ||
    normalizeText(row[fallbackSummaryField(table)]) ||
    normalizeText(row["备注"]);
  return truncateText(summary, 160);
}

function buildNodeGroup(table: KbTableName, row: Record<string, string>) {
  return normalizeText(row[groupField(table)]) || "";
}

export async function buildKnowledgeGraphData(options?: {
  includeAiSuggestions?: boolean;
  minSuggestionConfidence?: number;
}) {
  const includeAi = options?.includeAiSuggestions ?? true;
  const minSuggestionConfidence =
    options?.minSuggestionConfidence ?? aiSuggestionMinConfidence();

  const [links, aiSuggestions, ...tableRows] = await Promise.all([
    listKnowledgeLinks(),
    includeAi
      ? listPendingSuggestionsForGraph(minSuggestionConfidence)
      : Promise.resolve([]),
    ...TABLES.map((table) => readRows(table)),
  ]);

  const degreeMap = new Map<string, number>();
  for (const link of links) {
    const source = `${link.sourceTable}:${link.sourceId}`;
    const target = `${link.targetTable}:${link.targetId}`;
    degreeMap.set(source, (degreeMap.get(source) ?? 0) + 1);
    degreeMap.set(target, (degreeMap.get(target) ?? 0) + 1);
  }
  for (const s of aiSuggestions) {
    const source = `${s.sourceTable}:${s.sourceId}`;
    const target = `${s.targetTable}:${s.targetId}`;
    degreeMap.set(source, (degreeMap.get(source) ?? 0) + 1);
    degreeMap.set(target, (degreeMap.get(target) ?? 0) + 1);
  }

  const nodes = tableRows.flatMap((rows, index) => {
    const table = TABLES[index];
    return rows
      .map((row) => {
        const itemId = normalizeText(row[idField(table)]);
        if (!itemId) return null;
        const nodeId = `${table}:${itemId}`;
        return {
          id: nodeId,
          table,
          itemId,
          label: buildNodeLabel(table, row),
          title: buildNodeTitle(table, row),
          subtitle: buildNodeSubtitle(table, row),
          summary: buildNodeSummary(table, row),
          tags: normalizeTags(row.tags),
          degree: degreeMap.get(nodeId) ?? 0,
          isIsolated: (degreeMap.get(nodeId) ?? 0) === 0,
          groupLabel: buildNodeGroup(table, row),
        } satisfies GraphNode;
      })
      .filter((node): node is GraphNode => node !== null);
  });

  const nodeLabelMap = new Map(nodes.map((node) => [node.id, node.label]));

  const baseEdges = links.map(
    (link) =>
      ({
        id: link.id,
        source: `${link.sourceTable}:${link.sourceId}`,
        target: `${link.targetTable}:${link.targetId}`,
        linkType: link.linkType,
        sourceLabel: link.sourceLabel,
        targetLabel: link.targetLabel,
        sourceKind: link.source,
        aiConfidence: link.aiConfidence,
      }) satisfies GraphEdge,
  );

  const suggestionEdges = aiSuggestions.map((s) => {
    const source = `${s.sourceTable}:${s.sourceId}`;
    const target = `${s.targetTable}:${s.targetId}`;
    return {
      id: `suggestion-${s.id}`,
      source,
      target,
      linkType: s.linkType,
      sourceLabel: nodeLabelMap.get(source) ?? s.sourceId,
      targetLabel: nodeLabelMap.get(target) ?? s.targetId,
      sourceKind: "ai-suggested" as const,
      aiConfidence: s.confidence,
    } satisfies GraphEdge;
  });

  return { nodes, edges: [...baseEdges, ...suggestionEdges], tables: TABLES };
}
