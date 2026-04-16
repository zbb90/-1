"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphEdge, GraphNode } from "@/lib/knowledge-graph";

type TableKey = GraphNode["table"];
type LayoutMode = "free" | "table" | "group";
type PositionedNode = GraphNode & SimulationNodeDatum;
type PositionedEdge = Omit<GraphEdge, "source" | "target"> &
  SimulationLinkDatum<PositionedNode>;
type HoverState =
  | { kind: "node"; node: PositionedNode; x: number; y: number }
  | { kind: "edge"; edge: PositionedEdge; x: number; y: number }
  | null;

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

const LINK_TYPE_LABELS: Record<GraphEdge["linkType"], string> = {
  references: "引用",
  supports: "支撑",
  related: "一般关联",
  supersedes: "替代",
  contradicts: "冲突",
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

function buildGroupList(nodes: GraphNode[]) {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (!node.groupLabel) continue;
    counts.set(node.groupLabel, (counts.get(node.groupLabel) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, "zh-CN");
    });
}

function edgeStroke(edge: { linkType: GraphEdge["linkType"] }) {
  if (edge.linkType === "contradicts") return "#dc2626";
  if (edge.linkType === "supersedes") return "#9333ea";
  if (edge.linkType === "supports") return "#16a34a";
  if (edge.linkType === "references") return "#2563eb";
  return "#94a3b8";
}

function edgeDash(edge: {
  linkType: GraphEdge["linkType"];
  sourceKind: GraphEdge["sourceKind"];
}) {
  if (edge.linkType === "related") return "7 5";
  if (edge.linkType === "supersedes") return "3 4";
  if (edge.sourceKind === "derived") return "2 4";
  return undefined;
}

function truncateText(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trim()}...`;
}

function nodeRadius(node: GraphNode) {
  return 18 + Math.min(node.degree, 8) * 1.8;
}

function clusterKey(node: GraphNode, layoutMode: LayoutMode) {
  if (layoutMode === "table") return TABLE_LABELS[node.table];
  if (layoutMode === "group") return node.groupLabel || "未分类";
  return "全部";
}

function clusterPosition(index: number, count: number, width: number, height: number) {
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))));
  const rows = Math.max(1, Math.ceil(count / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: ((column + 0.5) * width) / columns,
    y: ((row + 0.5) * height) / rows,
  };
}

function StatChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-green-700 text-white shadow-sm"
          : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

export function KnowledgeGraphView({
  initialNodes,
  initialEdges,
}: {
  initialNodes: GraphNode[];
  initialEdges: GraphEdge[];
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selectedTable, setSelectedTable] = useState<TableKey | "all">("all");
  const [selectedTag, setSelectedTag] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [hideIsolated, setHideIsolated] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("group");
  const [hovered, setHovered] = useState<HoverState>(null);

  const filterBaseNodes = useMemo(
    () =>
      initialNodes.filter((node) =>
        selectedTable === "all" ? true : node.table === selectedTable,
      ),
    [initialNodes, selectedTable],
  );
  const tagList = useMemo(() => buildTagList(filterBaseNodes), [filterBaseNodes]);
  const groupList = useMemo(() => buildGroupList(filterBaseNodes), [filterBaseNodes]);

  const filtered = useMemo(() => {
    let nodes = filterBaseNodes;
    if (selectedTag) {
      nodes = nodes.filter((node) => node.tags.includes(selectedTag));
    }
    if (selectedGroup) {
      nodes = nodes.filter((node) => (node.groupLabel || "未分类") === selectedGroup);
    }
    if (hideIsolated) {
      nodes = nodes.filter((node) => !node.isIsolated);
    }

    const allowed = new Set(nodes.map((node) => node.id));
    const edges = initialEdges.filter(
      (edge) => allowed.has(edge.source) && allowed.has(edge.target),
    );
    return { nodes, edges };
  }, [filterBaseNodes, hideIsolated, initialEdges, selectedGroup, selectedTag]);

  const { layoutNodes, layoutEdges, width, height, clusterLabels } = useMemo(() => {
    const clusterNames = [
      ...new Set(filtered.nodes.map((node) => clusterKey(node, layoutMode))),
    ];
    const clusterCount = Math.max(1, clusterNames.length);
    const columns =
      layoutMode === "free"
        ? 1
        : Math.min(4, Math.max(1, Math.ceil(Math.sqrt(clusterCount))));
    const rows = layoutMode === "free" ? 1 : Math.ceil(clusterCount / columns);
    const width = Math.max(1520, columns * 460);
    const height = Math.max(920, rows * 360 + Math.min(filtered.nodes.length * 3, 220));
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
      return {
        layoutNodes: [] as PositionedNode[],
        layoutEdges: [] as PositionedEdge[],
        width,
        height,
        clusterLabels: [] as Array<{ label: string; x: number; y: number }>,
      };
    }

    const clusterIndex = new Map(clusterNames.map((label, index) => [label, index]));
    const simulation = forceSimulation<PositionedNode>(nodes)
      .force("charge", forceManyBody().strength(-360))
      .force("center", forceCenter(width / 2, height / 2))
      .force(
        "collision",
        forceCollide<PositionedNode>().radius((node) => nodeRadius(node) + 42),
      )
      .force(
        "link",
        forceLink<PositionedNode, PositionedEdge>(edges)
          .id((node) => node.id)
          .distance((edge) => (edge.linkType === "references" ? 120 : 156))
          .strength((edge) => (edge.linkType === "related" ? 0.35 : 0.55)),
      )
      .stop();

    if (layoutMode !== "free") {
      simulation
        .force(
          "x",
          forceX<PositionedNode>((node) => {
            const key = clusterKey(node, layoutMode);
            const index = clusterIndex.get(key) ?? 0;
            return clusterPosition(index, clusterCount, width, height).x;
          }).strength(0.22),
        )
        .force(
          "y",
          forceY<PositionedNode>((node) => {
            const key = clusterKey(node, layoutMode);
            const index = clusterIndex.get(key) ?? 0;
            return clusterPosition(index, clusterCount, width, height).y;
          }).strength(0.18),
        );
    }

    for (let i = 0; i < 260; i += 1) {
      simulation.tick();
    }
    simulation.stop();

    return {
      layoutNodes: [...nodes],
      layoutEdges: [...edges],
      width,
      height,
      clusterLabels:
        layoutMode === "free"
          ? []
          : clusterNames.map((label, index) => {
              const point = clusterPosition(index, clusterCount, width, height);
              return { label, x: point.x, y: Math.max(48, point.y - 140) };
            }),
    };
  }, [filtered.edges, filtered.nodes, layoutMode]);

  const selectedNode = layoutNodes.find((node) => node.id === selectedNodeId) ?? null;
  const previewNode = hovered?.kind === "node" ? hovered.node : selectedNode;
  const previewEdge = hovered?.kind === "edge" ? hovered.edge : null;

  function showNodeTooltip(event: React.MouseEvent<SVGGElement>, node: PositionedNode) {
    setHovered({ kind: "node", node, x: event.clientX + 16, y: event.clientY + 16 });
  }

  function showEdgeTooltip(
    event: React.MouseEvent<SVGLineElement>,
    edge: PositionedEdge,
  ) {
    setHovered({ kind: "edge", edge, x: event.clientX + 16, y: event.clientY + 16 });
  }

  function resetFilters() {
    setSelectedTable("all");
    setSelectedTag("");
    setSelectedGroup("");
    setHideIsolated(false);
    setLayoutMode("group");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-start gap-3">
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

            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
            >
              <option value="">全部分类</option>
              {groupList.map((item) => (
                <option key={item.label} value={item.label}>
                  {item.label}（{item.count}）
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={hideIsolated}
                onChange={(e) => setHideIsolated(e.target.checked)}
              />
              仅看已关联节点
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatChip
              active={layoutMode === "group"}
              onClick={() => setLayoutMode("group")}
            >
              按分类分组
            </StatChip>
            <StatChip
              active={layoutMode === "table"}
              onClick={() => setLayoutMode("table")}
            >
              按知识表分组
            </StatChip>
            <StatChip
              active={layoutMode === "free"}
              onClick={() => setLayoutMode("free")}
            >
              自由布局
            </StatChip>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span>节点 {layoutNodes.length}</span>
            <span>连线 {layoutEdges.length}</span>
            <span>分类 {clusterLabels.length || 1}</span>
            <button
              onClick={resetFilters}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              重置筛选
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
          <div className="border-b border-gray-100 px-4 py-3 text-sm text-gray-500">
            画布已扩大为大屏工作区。可横向滚动查看完整布局，悬停即可预览内容。
          </div>
          <div ref={canvasRef} className="relative overflow-auto bg-slate-50">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="bg-slate-50"
              style={{ width: `${width}px`, height: `${height}px` }}
            >
              <rect x={0} y={0} width={width} height={height} fill="#f8fafc" />

              {clusterLabels.map((cluster) => (
                <g key={cluster.label}>
                  <text
                    x={cluster.x}
                    y={cluster.y}
                    textAnchor="middle"
                    className="fill-slate-400 text-[16px] font-semibold"
                  >
                    {truncateText(cluster.label, 18)}
                  </text>
                </g>
              ))}

              {layoutEdges.map((edge) => {
                const source = edge.source as PositionedNode;
                const target = edge.target as PositionedNode;
                const isPreviewed =
                  hovered?.kind === "edge" && hovered.edge.id === edge.id;
                return (
                  <line
                    key={edge.id}
                    x1={source.x || 0}
                    y1={source.y || 0}
                    x2={target.x || 0}
                    y2={target.y || 0}
                    stroke={edgeStroke(edge)}
                    strokeWidth={
                      isPreviewed ? 3 : edge.linkType === "contradicts" ? 2.6 : 1.8
                    }
                    strokeDasharray={edgeDash(edge)}
                    opacity={isPreviewed ? 0.95 : 0.72}
                    onMouseEnter={(event) => showEdgeTooltip(event, edge)}
                    onMouseMove={(event) => showEdgeTooltip(event, edge)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <title>
                      {LINK_TYPE_LABELS[edge.linkType]}: {edge.sourceLabel}
                      {" -> "}
                      {edge.targetLabel}
                    </title>
                  </line>
                );
              })}

              {layoutNodes.map((node) => {
                const radius = nodeRadius(node);
                const title = truncateText(node.title || node.label, 12);
                const subtitle = truncateText(node.subtitle || node.itemId, 14);
                const isSelected = selectedNodeId === node.id;
                const isHovered =
                  hovered?.kind === "node" && hovered.node.id === node.id;
                return (
                  <g
                    key={node.id}
                    onMouseEnter={(event) => showNodeTooltip(event, node)}
                    onMouseMove={(event) => showNodeTooltip(event, node)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => setSelectedNodeId(node.id)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={node.x || 0}
                      cy={node.y || 0}
                      r={radius}
                      fill={TABLE_COLORS[node.table]}
                      opacity={
                        selectedNodeId && selectedNodeId !== node.id && !isHovered
                          ? 0.5
                          : 0.96
                      }
                      stroke={isSelected ? "#0f172a" : isHovered ? "#1e293b" : "#fff"}
                      strokeWidth={isSelected ? 4 : isHovered ? 2.5 : 1.5}
                    />
                    <text
                      x={node.x || 0}
                      y={(node.y || 0) + radius + 18}
                      textAnchor="middle"
                      className="fill-slate-700 text-[12px] font-medium"
                    >
                      <tspan x={node.x || 0}>{title}</tspan>
                      <tspan
                        x={node.x || 0}
                        dy="1.15em"
                        className="fill-slate-500 text-[10px] font-normal"
                      >
                        {subtitle}
                      </tspan>
                    </text>
                    <title>{node.label}</title>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">图谱说明</h3>
            <div className="mt-3 space-y-2 text-xs text-gray-500">
              <p>节点颜色表示知识表来源，节点越大代表关联越多。</p>
              <p>节点默认显示标题与副标题，不再只显示编号。</p>
              <p>切换“按分类分组 / 按知识表分组”可快速看清结构。</p>
            </div>
            <div className="mt-4 grid gap-2">
              {Object.entries(TABLE_LABELS).map(([table, label]) => (
                <div
                  key={table}
                  className="flex items-center justify-between gap-2 text-xs text-gray-600"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: TABLE_COLORS[table as TableKey] }}
                    />
                    {label}
                  </div>
                  <span>
                    {
                      initialNodes.filter((node) => node.table === (table as TableKey))
                        .length
                    }{" "}
                    个
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">悬停预览</h3>
            {hovered?.kind === "edge" && previewEdge ? (
              <div className="mt-3 space-y-2 text-sm text-gray-700">
                <p className="font-medium text-gray-900">
                  {LINK_TYPE_LABELS[previewEdge.linkType]}
                </p>
                <p>{previewEdge.sourceLabel}</p>
                <p className="text-xs text-gray-400">↓</p>
                <p>{previewEdge.targetLabel}</p>
                <p className="text-xs text-gray-500">
                  来源：{previewEdge.sourceKind === "manual" ? "人工维护" : "系统提取"}
                </p>
              </div>
            ) : previewNode ? (
              <div className="mt-3 space-y-2 text-sm text-gray-700">
                <p className="font-medium text-gray-900">{previewNode.title}</p>
                <p>编号：{previewNode.itemId}</p>
                <p>表类型：{TABLE_LABELS[previewNode.table]}</p>
                <p>分类：{previewNode.groupLabel || "未分类"}</p>
                <p>关联数：{previewNode.degree}</p>
                {previewNode.summary ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {previewNode.summary}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  {previewNode.tags.length > 0 ? (
                    previewNode.tags.map((tag) => (
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
              <p className="mt-3 text-sm text-gray-500">
                把鼠标移到节点或连线上可直接预览。
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">选中节点详情</h3>
            {selectedNode ? (
              <div className="mt-3 space-y-2 text-sm text-gray-700">
                <p className="font-medium text-gray-900">{selectedNode.title}</p>
                <p>完整标签：{selectedNode.label}</p>
                <p>编号：{selectedNode.itemId}</p>
                <p>分类：{selectedNode.groupLabel || "未分类"}</p>
                <p>关联数：{selectedNode.degree}</p>
                <p>是否孤立：{selectedNode.isIsolated ? "是" : "否"}</p>
                {selectedNode.summary ? (
                  <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {selectedNode.summary}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-500">
                点击图中的节点，可固定查看该节点详情。
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">高频分类</h3>
            {groupList.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {groupList.slice(0, 18).map((group) => (
                  <button
                    key={group.label}
                    onClick={() =>
                      setSelectedGroup((current) =>
                        current === group.label ? "" : group.label,
                      )
                    }
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      selectedGroup === group.label
                        ? "bg-blue-700 text-white"
                        : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                    }`}
                  >
                    {group.label}（{group.count}）
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-500">当前筛选范围内暂无可用分类。</p>
            )}
          </div>
        </div>
      </div>

      {hovered ? (
        <div
          className="pointer-events-none fixed z-50 max-w-sm rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-sm shadow-lg backdrop-blur"
          style={{ left: hovered.x, top: hovered.y }}
        >
          {hovered.kind === "node" ? (
            <div className="space-y-1.5 text-slate-700">
              <p className="font-semibold text-slate-900">{hovered.node.title}</p>
              <p>
                {TABLE_LABELS[hovered.node.table]} · {hovered.node.itemId}
              </p>
              <p>分类：{hovered.node.groupLabel || "未分类"}</p>
              {hovered.node.summary ? (
                <p className="text-xs text-slate-500">{hovered.node.summary}</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1.5 text-slate-700">
              <p className="font-semibold text-slate-900">
                {LINK_TYPE_LABELS[hovered.edge.linkType]}
              </p>
              <p className="text-xs">{hovered.edge.sourceLabel}</p>
              <p className="text-xs">{hovered.edge.targetLabel}</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
