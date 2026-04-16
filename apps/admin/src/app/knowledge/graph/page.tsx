import Link from "next/link";
import { cookies } from "next/headers";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { listKnowledgeLinks } from "@/lib/link-store";
import type { KbTableName } from "@/lib/kb-schema";
import { readRows } from "@/lib/knowledge-store";
import { normalizeTags } from "@/lib/knowledge-tags";
import { KnowledgeGraphView } from "./graph-view";

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

export default async function KnowledgeGraphPage() {
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  const isLeader = session?.role === "leader";
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

  const degreeMap = new Map<string, number>();
  for (const link of links) {
    const source = `${link.sourceTable}:${link.sourceId}`;
    const target = `${link.targetTable}:${link.targetId}`;
    degreeMap.set(source, (degreeMap.get(source) ?? 0) + 1);
    degreeMap.set(target, (degreeMap.get(target) ?? 0) + 1);
  }

  const nodes = tableRows.flatMap((rows, index) => {
    const table = tables[index];
    return rows
      .map((row) => {
        const itemId = row[idField(table)]?.trim();
        if (!itemId) return null;
        const nodeId = `${table}:${itemId}`;
        return {
          id: nodeId,
          table,
          itemId,
          label: buildNodeLabel(table, row),
          tags: normalizeTags(row.tags),
          degree: degreeMap.get(nodeId) ?? 0,
          isIsolated: (degreeMap.get(nodeId) ?? 0) === 0,
        };
      })
      .filter(Boolean);
  });

  const edges = links.map((link) => ({
    id: link.id,
    source: `${link.sourceTable}:${link.sourceId}`,
    target: `${link.targetTable}:${link.targetId}`,
    linkType: link.linkType,
    sourceLabel: link.sourceLabel,
    targetLabel: link.targetLabel,
    sourceKind: link.source,
  }));

  return (
    <AdminShell>
      <AdminPageHeader
        eyebrow="知识图谱"
        title="知识关系图谱"
        description={
          <>
            用图谱视角查看规则、共识、外购、旧品、操作知识之间的关联网络。
            <br />
            节点来自现有知识表，连线来自手动链接和系统自动提取的关联。
          </>
        }
        actions={
          <AdminNav
            current="knowledge"
            showUsersLink={isLeader}
            showStorageLink={isLeader}
          />
        }
        footer={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/knowledge"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              返回知识库
            </Link>
            <Link
              href="/knowledge/health"
              className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
            >
              查看健康度
            </Link>
          </div>
        }
      />

      <KnowledgeGraphView
        initialNodes={
          nodes as Array<{
            id: string;
            table: KbTableName;
            itemId: string;
            label: string;
            tags: string[];
            degree: number;
            isIsolated: boolean;
          }>
        }
        initialEdges={edges}
      />
    </AdminShell>
  );
}
