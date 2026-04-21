import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { buildKnowledgeGraphData } from "@/lib/knowledge-graph";
import type { KbTableName } from "@/lib/kb-schema";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  try {
    const tableFilter = request.nextUrl.searchParams
      .get("table")
      ?.trim() as KbTableName | null;
    const tagFilter = request.nextUrl.searchParams.get("tag")?.trim() || "";
    const includeIsolated = request.nextUrl.searchParams.get("includeIsolated") !== "0";
    const includeAiSuggestions = request.nextUrl.searchParams.get("includeAi") !== "0";
    const {
      nodes: allNodes,
      edges: allEdges,
      tables,
    } = await buildKnowledgeGraphData({ includeAiSuggestions });
    let nodes = [...allNodes];
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
    const edges = allEdges.filter(
      (edge) => allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target),
    );

    return NextResponse.json({
      ok: true,
      data: {
        nodes,
        edges,
        summary: {
          nodes: nodes.length,
          edges: edges.length,
          isolatedNodes: nodes.filter((node) => node.isIsolated).length,
          aiSuggestedEdges: edges.filter((edge) => edge.sourceKind === "ai-suggested")
            .length,
          tables: Object.fromEntries(
            tables.map((table) => [
              table,
              nodes.filter((node) => node.table === table).length,
            ]),
          ),
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "读取知识图谱失败",
      },
      { status: 500 },
    );
  }
}
