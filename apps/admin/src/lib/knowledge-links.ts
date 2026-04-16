import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { KbTableName } from "@/lib/kb-schema";
import { readRows } from "@/lib/knowledge-store";
import { getRedis, isRedisConfigured } from "@/lib/redis-client";

type Row = Record<string, string>;

export type KnowledgeLinkType =
  | "references"
  | "supports"
  | "related"
  | "supersedes"
  | "contradicts";

export type KnowledgeLinkSource = "manual" | "derived";

export type KnowledgeLink = {
  id: string;
  sourceTable: KbTableName;
  sourceId: string;
  targetTable: KbTableName;
  targetId: string;
  linkType: KnowledgeLinkType;
  createdAt: string;
  source: KnowledgeLinkSource;
};

export type KnowledgeLinkWithLabels = KnowledgeLink & {
  sourceLabel: string;
  targetLabel: string;
};

const LINK_STORE_KEY = "audit:kb:links";
const SUPPORTED_TABLES: KbTableName[] = [
  "rules",
  "consensus",
  "external-purchases",
  "old-items",
  "operations",
];

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

function resolveDataDir() {
  const candidates = [
    resolve(/* turbopackIgnore: true */ process.cwd(), "data"),
    resolve(/* turbopackIgnore: true */ process.cwd(), "../../data"),
    resolve(/* turbopackIgnore: true */ process.cwd(), "../../../data"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

function getLinkFilePath() {
  return resolve(resolveDataDir(), "knowledge-links.json");
}

async function ensureLinkFile() {
  const dataDir = resolveDataDir();
  const filePath = getLinkFilePath();
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
  if (!existsSync(filePath)) {
    await writeFile(filePath, "[]\n", "utf-8");
  }
}

function parseStoredLink(raw: unknown): KnowledgeLink | null {
  const value = raw as Partial<KnowledgeLink> | null;
  if (!value?.id || !value.sourceId || !value.targetId) return null;
  if (
    !SUPPORTED_TABLES.includes(value.sourceTable as KbTableName) ||
    !SUPPORTED_TABLES.includes(value.targetTable as KbTableName)
  ) {
    return null;
  }
  return {
    id: value.id,
    sourceTable: value.sourceTable as KbTableName,
    sourceId: value.sourceId,
    targetTable: value.targetTable as KbTableName,
    targetId: value.targetId,
    linkType: (value.linkType as KnowledgeLinkType) || "related",
    createdAt: value.createdAt || new Date(0).toISOString(),
    source: "manual",
  };
}

function linkSignature(link: Pick<KnowledgeLink, "sourceTable" | "sourceId" | "targetTable" | "targetId" | "linkType">) {
  return [
    link.sourceTable,
    link.sourceId,
    link.targetTable,
    link.targetId,
    link.linkType,
  ].join("::");
}

function buildLinkId() {
  return `KL-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
}

function parseIdTokens(raw: string, prefix: string) {
  const matches = raw.toUpperCase().match(new RegExp(`${prefix}-\\d{4}`, "g"));
  return [...new Set(matches ?? [])];
}

function parseClauseTokens(raw: string) {
  return raw
    .split(/[，,、；;\/\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

async function readStoredLinks(): Promise<KnowledgeLink[]> {
  if (isRedisConfigured()) {
    try {
      const redis = await getRedis();
      const raw = await redis.get<unknown[]>(LINK_STORE_KEY);
      if (!Array.isArray(raw)) return [];
      return raw.map(parseStoredLink).filter((item): item is KnowledgeLink => Boolean(item));
    } catch (error) {
      console.warn("[knowledge-links] failed to read redis links, fallback to file", error);
    }
  }

  await ensureLinkFile();
  const raw = await readFile(getLinkFilePath(), "utf-8").catch(() => "[]");
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseStoredLink).filter((item): item is KnowledgeLink => Boolean(item));
  } catch (error) {
    console.warn("[knowledge-links] failed to parse local links file", error);
    return [];
  }
}

async function writeStoredLinks(links: KnowledgeLink[]) {
  const manualOnly = links
    .filter((link) => link.source === "manual")
    .map(({ source, ...link }) => link);

  if (isRedisConfigured()) {
    try {
      const redis = await getRedis();
      await redis.set(LINK_STORE_KEY, manualOnly);
      return;
    } catch (error) {
      console.warn("[knowledge-links] failed to persist links to redis, fallback to file", error);
    }
  }

  await ensureLinkFile();
  await writeFile(getLinkFilePath(), `${JSON.stringify(manualOnly, null, 2)}\n`, "utf-8");
}

async function buildEntryMaps() {
  const tables = await Promise.all(
    SUPPORTED_TABLES.map(async (table) => [table, await readRows(table)] as const),
  );
  const rowMap = new Map<string, Row>();

  for (const [table, rows] of tables) {
    const field = idField(table);
    for (const row of rows) {
      const id = row[field]?.trim();
      if (!id) continue;
      rowMap.set(`${table}:${id}`, row);
    }
  }

  return rowMap;
}

function getEntryLabel(table: KbTableName, row: Row | undefined, fallbackId: string) {
  if (!row) return fallbackId;
  const primary = row[primaryField(table)]?.trim();
  if (table === "rules") {
    const clauseNo = row["条款编号"]?.trim();
    return [fallbackId, clauseNo, primary].filter(Boolean).join("｜");
  }
  return [fallbackId, primary].filter(Boolean).join("｜");
}

async function buildDerivedLinks(): Promise<KnowledgeLink[]> {
  const [rules, consensus] = await Promise.all([readRows("rules"), readRows("consensus")]);
  const links: KnowledgeLink[] = [];
  const consensusIds = new Set(consensus.map((row) => row.consensus_id?.trim()).filter(Boolean));
  const rulesByClause = new Map<string, string[]>();

  for (const rule of rules) {
    const clauseNo = rule["条款编号"]?.trim();
    if (!clauseNo) continue;
    const list = rulesByClause.get(clauseNo) ?? [];
    list.push(rule.rule_id);
    rulesByClause.set(clauseNo, list);
  }

  for (const rule of rules) {
    const ruleId = rule.rule_id?.trim();
    if (!ruleId) continue;
    const consensusRefs = parseIdTokens(rule["共识来源"] || "", "C").filter((id) =>
      consensusIds.has(id),
    );
    for (const consensusId of consensusRefs) {
      links.push({
        id: `derived-rule-${ruleId}-${consensusId}`,
        sourceTable: "rules",
        sourceId: ruleId,
        targetTable: "consensus",
        targetId: consensusId,
        linkType: "supports",
        createdAt: new Date(0).toISOString(),
        source: "derived",
      });
    }
  }

  for (const item of consensus) {
    const consensusId = item.consensus_id?.trim();
    if (!consensusId) continue;
    const clauseTokens = parseClauseTokens(item["关联条款编号"] || "");
    for (const clauseNo of clauseTokens) {
      const matchedRules = rulesByClause.get(clauseNo) ?? [];
      for (const ruleId of matchedRules) {
        links.push({
          id: `derived-consensus-${consensusId}-${ruleId}-${clauseNo}`,
          sourceTable: "consensus",
          sourceId: consensusId,
          targetTable: "rules",
          targetId: ruleId,
          linkType: "references",
          createdAt: new Date(0).toISOString(),
          source: "derived",
        });
      }
    }
  }

  const deduped = new Map<string, KnowledgeLink>();
  for (const link of links) {
    deduped.set(linkSignature(link), link);
  }
  return [...deduped.values()];
}

export async function listDerivedKnowledgeLinks(): Promise<KnowledgeLinkWithLabels[]> {
  return resolveLinks(await buildDerivedLinks());
}

async function resolveLinks(links: KnowledgeLink[]) {
  const rowMap = await buildEntryMaps();
  return links.map((link) => ({
    ...link,
    sourceLabel: getEntryLabel(
      link.sourceTable,
      rowMap.get(`${link.sourceTable}:${link.sourceId}`),
      link.sourceId,
    ),
    targetLabel: getEntryLabel(
      link.targetTable,
      rowMap.get(`${link.targetTable}:${link.targetId}`),
      link.targetId,
    ),
  }));
}

async function ensureEntryExists(table: KbTableName, id: string) {
  const rows = await readRows(table);
  const field = idField(table);
  return rows.some((row) => row[field]?.trim() === id.trim());
}

export async function listKnowledgeLinks(): Promise<KnowledgeLinkWithLabels[]> {
  const [manual, derived] = await Promise.all([readStoredLinks(), buildDerivedLinks()]);
  const deduped = new Map<string, KnowledgeLink>();
  for (const link of [...manual, ...derived]) {
    deduped.set(linkSignature(link), link);
  }
  return resolveLinks([...deduped.values()]);
}

export async function getKnowledgeLinksForEntry(table: KbTableName, id: string) {
  const links = await listKnowledgeLinks();
  return {
    forward: links.filter((link) => link.sourceTable === table && link.sourceId === id),
    backward: links.filter((link) => link.targetTable === table && link.targetId === id),
  };
}

export async function addKnowledgeLink(input: {
  sourceTable: KbTableName;
  sourceId: string;
  targetTable: KbTableName;
  targetId: string;
  linkType: KnowledgeLinkType;
}) {
  const sourceId = input.sourceId.trim();
  const targetId = input.targetId.trim();
  if (!sourceId || !targetId) {
    throw new Error("关联条目编号不能为空。");
  }
  if (input.sourceTable === input.targetTable && sourceId === targetId) {
    throw new Error("不能关联到自己。");
  }

  const [sourceExists, targetExists] = await Promise.all([
    ensureEntryExists(input.sourceTable, sourceId),
    ensureEntryExists(input.targetTable, targetId),
  ]);
  if (!sourceExists || !targetExists) {
    throw new Error("关联条目不存在，请检查编号。");
  }

  const manualLinks = await readStoredLinks();
  const next: KnowledgeLink = {
    id: buildLinkId(),
    sourceTable: input.sourceTable,
    sourceId,
    targetTable: input.targetTable,
    targetId,
    linkType: input.linkType,
    createdAt: new Date().toISOString(),
    source: "manual",
  };

  const existingLinks = await listKnowledgeLinks();
  const duplicate = existingLinks.find((link) => linkSignature(link) === linkSignature(next));
  if (duplicate) {
    return duplicate;
  }

  await writeStoredLinks([...manualLinks, next]);
  return resolveLinks([next]).then((items) => items[0]);
}

export async function removeKnowledgeLink(id: string) {
  const manualLinks = await readStoredLinks();
  const nextLinks = manualLinks.filter((link) => link.id !== id);
  if (nextLinks.length === manualLinks.length) return false;
  await writeStoredLinks(nextLinks);
  return true;
}

export async function materializeDerivedKnowledgeLinks() {
  const [manualLinks, derivedLinks] = await Promise.all([readStoredLinks(), buildDerivedLinks()]);
  const manualSignatures = new Set(manualLinks.map((link) => linkSignature(link)));
  const seeded: KnowledgeLink[] = [];

  for (const link of derivedLinks) {
    if (manualSignatures.has(linkSignature(link))) continue;
    seeded.push({
      ...link,
      id: buildLinkId(),
      createdAt: new Date().toISOString(),
      source: "manual",
    });
  }

  if (seeded.length > 0) {
    await writeStoredLinks([...manualLinks, ...seeded]);
  }

  return {
    added: seeded.length,
    totalManual: manualLinks.length + seeded.length,
  };
}
