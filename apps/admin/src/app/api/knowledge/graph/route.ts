import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import type { KbTableName } from "@/lib/kb-schema";
import { listKnowledgeLinks } from "@/lib/link-store";
import { readRows } from "@/lib/knowledge-store";
import { normalizeTags } from "@/lib/knowledge-tags";

export const dynamic = "force-dynamic";

type GraphNode = {
  id: string;
  table: KbTableName;
  itemId: string;
  label: string;
  tags: string[];
  degree: number;
  isIsolated: boolean;
};

function idField(table: KbTableName) {
  if (table === "rules") return "rule_id";
  if (table === "consensus") return "consensus_id";
  if (table === "operations") return "op_id";
  return "item_id";
}

function primaryField(table: KbTableName) {
  if (table === "rules") return "条款标题";
  if (table === "consensus" || table === "operations") return "标题";
  return "物品名称";
}

function buildNodeLabel(table: KbTableName, row: Record<string, string>) {
  const itemId = row[idField(table)]?.trim() || "-";
  const primary = row[primaryField(table)]?.trim();
  if (table === "rules") {
    const clauseNo = row["条款编号"]?.trim();
    return [itemId, clauseNo, primary].filter(Boolean).join("｜");
  }
  return [itemId, primary].filter(Boolean).join("｜");
}

export async function GET(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json({ ok: false, message: "需要管理员身份。" }, { status: 401 });
  }

  try {
    const tableFilter = request.nextUrl.searchParams.get("table")?.trim() as KbTableName | null;
    const tagFilter = request.nextUrl.searchParams.get("tag")?.trim() || "";
    const includeIsolated = request.nextUrl.searchParams.get("includeIsolated") !== "0";
    const tables: KbTableName[] = [
      "rules",
      "consensus",
      "external-purchases",
      "old-items",
      "operations",
    ];

    const [links, ...tableRows] = await Promise.all([
      listKnowledgeLinks(),
      ...tables.map((table) => readRows(table)),
    ]);

    const nodeMap = new Map<string, GraphNode>();
    const degreeMap = new Map<string, number>();

    for (const link of links) {
      const sourceKey = `${link.sourceTable}:${link.sourceId}`;
      const targetKey = `${link.targetTable}:${link.targetId}`;
      degreeMap.set(sourceKey, (degreeMap.get(sourceKey) ?? 0) + 1);
      degreeMap.set(targetKey, (degreeMap.get(targetKey) ?? 0) + 1);
    }

    tableRows.forEach((rows, index) => {
      const table = tables[index];
      for (const row of rows) {
        const itemId = row[idField(table)]?.trim();
        if (!itemId) continue;
        const key = `${table}:${itemId}`;
        const tags = normalizeTags(row.tags);
        nodeMap.set(key, {
          id: key,
          table,
          itemId,
          label: buildNodeLabel(table, row),
          tags,
          degree: degreeMap.get(key) ?? 0,
          isIsolated: (degreeMap.get(key) ?? 0) === 0,
        });
      }
    });

    let nodes = [...nodeMap.values()];
    if (tableFilter && tables.includes(tableFilter)) {
      nodes = nodes.filter((node) => node.table === tableFilter);
    }
    if (tagFilter) {
      nodes = nodes.filter((node) => node.tags.includes(tagFilter));
    }
    if (!includeIsolated) {
      nodes = nodes.filter((node) => !node.isIsolated);
    }

    const allowedNodeIds = new Set(nodes.map((node) => node.id));
    const edges = links
      .map((link) => ({
        id: link.id,
        source: `${link.sourceTable}:${link.sourceId}`,
        target: `${link.targetTable}:${link.targetId}`,
        linkType: link.linkType,
        sourceLabel: link.sourceLabel,
        targetLabel: link.targetLabel,
        sourceKind: link.source,
      }))
      .filter((edge) => allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target));

    return NextResponse.json({
      ok: true,
      data: {
        nodes,
        edges,
        summary: {
          nodes: nodes.length,
          edges: edges.length,
          isolatedNodes: nodes.filter((node) => node.isIsolated).length,
          tables: Object.fromEntries(
            tables.map((table) => [table, nodes.filter((node) => node.table === table).length]),
          ),
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "读取知识图谱失败" },
      { status: 500 },
    );
  }
}
