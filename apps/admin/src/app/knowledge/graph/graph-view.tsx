"use client";

import { useMemo, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

type TableKey =
  | "rules"
  | "consensus"
  | "external-purchases"
  | "old-items"
  | "operations";

type GraphNode = {
  id: string;
  table: TableKey;
  itemId: string;
  label: string;
  tags: string[];
  degree: number;
  isIsolated: boolean;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  linkType: "references" | "supports" | "related" | "supersedes" | "contradicts";
  sourceLabel: string;
  targetLabel: string;
  sourceKind: "manual" | "derived";
};

type PositionedNode = GraphNode & SimulationNodeDatum;
type PositionedEdge = Omit<GraphEdge, "source" | "target"> &
  SimulationLinkDatum<PositionedNode>;

const TABLE_LABELS: Record<TableKey, string> = {
  rules: "规则",
  consensus: "共识",
  "external-purchases": "外购",
  "old-items": "旧品",
  operations: "操作",
};

const TABLE_COLORS: Record<TableKey, string> = {
  rules: "#2563eb",
  consensus: "#16a34a",
  "external-purchases": "#ea580c",
  "old-items": "#7c3aed",
  operations: "#4b5563",
};

function buildTagList(nodes: GraphNode[]) {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const tag of node.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag, "zh-CN");
    });
}

function edgeStroke(edge: { linkType: GraphEdge["linkType"] }) {
  if (edge.linkType === "contradicts") return "#dc2626";
  if (edge.linkType === "supersedes") return "#9333ea";
  if (edge.linkType === "supports") return "#16a34a";
  return "#94a3b8";
}

export function KnowledgeGraphView({
  initialNodes,
  initialEdges,
}: {
  initialNodes: GraphNode[];
  initialEdges: GraphEdge[];
}) {
  const [selectedTable, setSelectedTable] = useState<TableKey | "all">("all");
  const [selectedTag, setSelectedTag] = useState("");
  const [hideIsolated, setHideIsolated] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState("");

  const tagList = useMemo(() => buildTagList(initialNodes), [initialNodes]);

  const filtered = useMemo(() => {
    let nodes = initialNodes.filter((node) =>
      selectedTable === "all" ? true : node.table === selectedTable,
    );
    if (selectedTag) {
      nodes = nodes.filter((node) => node.tags.includes(selectedTag));
    }
    if (hideIsolated) {
      nodes = nodes.filter((node) => !node.isIsolated);
    }

    const allowed = new Set(nodes.map((node) => node.id));
    const edges = initialEdges.filter(
      (edge) => allowed.has(edge.source) && allowed.has(edge.target),
    );
    return { nodes, edges };
  }, [hideIsolated, initialEdges, initialNodes, selectedTable, selectedTag]);

  const { layoutNodes, layoutEdges } = useMemo(() => {
    const width = 1120;
    const height = 720;
    const nodes: PositionedNode[] = filtered.nodes.map((node) => ({ ...node }));
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const edges = filtered.edges.reduce<PositionedEdge[]>((acc, edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return acc;
      acc.push({ ...edge, source, target });
      return acc;
    }, []);

    if (nodes.length === 0) {
      return { layoutNodes: [], layoutEdges: [] };
    }

    const simulation = forceSimulation<PositionedNode>(nodes)
      .force("charge", forceManyBody().strength(-190))
      .force("center", forceCenter(width / 2, height / 2))
      .force(
        "collision",
        forceCollide<PositionedNode>().radius(
          (node) => 18 + Math.min(node.degree, 6) * 2,
        ),
      )
      .force(
        "link",
        forceLink<PositionedNode, PositionedEdge>(edges)
          .id((node) => node.id)
          .distance((edge) => (edge.linkType === "references" ? 90 : 120)),
      )
      .stop();

    for (let i = 0; i < 180; i += 1) {
      simulation.tick();
    }
    simulation.stop();

    return {
      layoutNodes: [...nodes],
      layoutEdges: [...edges],
    };
  }, [filtered]);

  const selectedNode = layoutNodes.find((node) => node.id === selectedNodeId) ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value as TableKey | "all")}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
          >
            <option value="all">全部表</option>
            {Object.entries(TABLE_LABELS).map(([table, label]) => (
              <option key={table} value={table}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
          >
            <option value="">全部标签</option>
            {tagList.map((item) => (
              <option key={item.tag} value={item.tag}>
                {item.tag}（{item.count}）
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={hideIsolated}
              onChange={(e) => setHideIsolated(e.target.checked)}
            />
            隐藏孤立节点
          </label>

          <div className="ml-auto text-xs text-gray-500">
            节点 {layoutNodes.length} · 连线 {layoutEdges.length}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
          <svg viewBox="0 0 1120 720" className="h-[720px] w-full bg-slate-50">
            {layoutEdges.map((edge) => {
              const source = edge.source as PositionedNode;
              const target = edge.target as PositionedNode;
              return (
                <line
                  key={edge.id}
                  x1={source.x || 0}
                  y1={source.y || 0}
                  x2={target.x || 0}
                  y2={target.y || 0}
                  stroke={edgeStroke(edge)}
                  strokeWidth={edge.linkType === "contradicts" ? 2.5 : 1.6}
                  strokeDasharray={
                    edge.linkType === "related"
                      ? "6 4"
                      : edge.linkType === "supersedes"
                        ? "2 3"
                        : undefined
                  }
                  opacity={0.7}
                />
              );
            })}

            {layoutNodes.map((node) => {
              const radius = 12 + Math.min(node.degree, 8);
              return (
                <g
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={node.x || 0}
                    cy={node.y || 0}
                    r={radius}
                    fill={TABLE_COLORS[node.table]}
                    opacity={selectedNodeId && selectedNodeId !== node.id ? 0.6 : 0.95}
                    stroke={selectedNodeId === node.id ? "#0f172a" : "#fff"}
                    strokeWidth={selectedNodeId === node.id ? 3 : 1.5}
                  />
                  <text
                    x={node.x || 0}
                    y={(node.y || 0) + radius + 14}
                    textAnchor="middle"
                    className="fill-slate-700 text-[10px]"
                  >
                    {node.itemId}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">图谱说明</h3>
            <div className="mt-3 space-y-2 text-xs text-gray-500">
              <p>节点颜色表示知识表来源，节点越大代表关联越多。</p>
              <p>绿色线为支撑，紫色线为替代，红色线为冲突，虚线为一般关联。</p>
              <p>孤立节点通常意味着缺少关联或知识沉淀不足。</p>
            </div>
            <div className="mt-4 grid gap-2">
              {Object.entries(TABLE_LABELS).map(([table, label]) => (
                <div
                  key={table}
                  className="flex items-center gap-2 text-xs text-gray-600"
                >
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: TABLE_COLORS[table as TableKey] }}
                  />
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">节点详情</h3>
            {selectedNode ? (
              <div className="mt-3 space-y-2 text-sm text-gray-700">
                <p className="font-medium text-gray-900">{selectedNode.label}</p>
                <p>表类型：{TABLE_LABELS[selectedNode.table]}</p>
                <p>关联数：{selectedNode.degree}</p>
                <p>是否孤立：{selectedNode.isIsolated ? "是" : "否"}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {selectedNode.tags.length > 0 ? (
                    selectedNode.tags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setSelectedTag(tag)}
                        className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100"
                      >
                        #{tag}
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-gray-400">暂无标签</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-500">点击图中的节点查看详情。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
