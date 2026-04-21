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

export type KnowledgeLinkSource = "manual" | "derived" | "ai";

export type KnowledgeLink = {
  id: string;
  sourceTable: KbTableName;
  sourceId: string;
  targetTable: KbTableName;
  targetId: string;
  linkType: KnowledgeLinkType;
  createdAt: string;
  source: KnowledgeLinkSource;
  // AI 采纳路径会额外携带一段简短原因；manual/derived 时为 undefined。
  aiConfidence?: number;
  aiReason?: string;
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
  // 老数据没有 source 字段，按 manual 处理；新增 ai 来源需要保留其置信度/理由。
  const rawSource = value.source === "ai" ? "ai" : "manual";
  return {
    id: value.id,
    sourceTable: value.sourceTable as KbTableName,
    sourceId: value.sourceId,
    targetTable: value.targetTable as KbTableName,
    targetId: value.targetId,
    linkType: (value.linkType as KnowledgeLinkType) || "related",
    createdAt: value.createdAt || new Date(0).toISOString(),
    source: rawSource,
    aiConfidence:
      rawSource === "ai" && typeof value.aiConfidence === "number"
        ? value.aiConfidence
        : undefined,
    aiReason:
      rawSource === "ai" && typeof value.aiReason === "string"
        ? value.aiReason
        : undefined,
  };
}

function linkSignature(
  link: Pick<
    KnowledgeLink,
    "sourceTable" | "sourceId" | "targetTable" | "targetId" | "linkType"
  >,
) {
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
      return raw
        .map(parseStoredLink)
        .filter((item): item is KnowledgeLink => Boolean(item));
    } catch (error) {
      console.warn(
        "[knowledge-links] failed to read redis links, fallback to file",
        error,
      );
    }
  }

  await ensureLinkFile();
  const raw = await readFile(getLinkFilePath(), "utf-8").catch(() => "[]");
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseStoredLink)
      .filter((item): item is KnowledgeLink => Boolean(item));
  } catch (error) {
    console.warn("[knowledge-links] failed to parse local links file", error);
    return [];
  }
}

async function writeStoredLinks(links: KnowledgeLink[]) {
  // 只持久化 manual 与 ai 两类；derived 每次动态生成。
  const persistable = links
    .filter((link) => link.source === "manual" || link.source === "ai")
    .map((link) => {
      const base = {
        id: link.id,
        sourceTable: link.sourceTable,
        sourceId: link.sourceId,
        targetTable: link.targetTable,
        targetId: link.targetId,
        linkType: link.linkType,
        createdAt: link.createdAt,
        source: link.source,
      };
      if (link.source === "ai") {
        return {
          ...base,
          aiConfidence: link.aiConfidence ?? null,
          aiReason: link.aiReason ?? null,
        };
      }
      return base;
    });

  if (isRedisConfigured()) {
    try {
      const redis = await getRedis();
      await redis.set(LINK_STORE_KEY, persistable);
      return;
    } catch (error) {
      console.warn(
        "[knowledge-links] failed to persist links to redis, fallback to file",
        error,
      );
    }
  }

  await ensureLinkFile();
  await writeFile(
    getLinkFilePath(),
    `${JSON.stringify(persistable, null, 2)}\n`,
    "utf-8",
  );
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
  const [rules, consensus] = await Promise.all([
    readRows("rules"),
    readRows("consensus"),
  ]);
  const links: KnowledgeLink[] = [];
  const consensusIds = new Set(
    consensus.map((row) => row.consensus_id?.trim()).filter(Boolean),
  );
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
    backward: links.filter(
      (link) => link.targetTable === table && link.targetId === id,
    ),
  };
}

export async function addKnowledgeLink(input: {
  sourceTable: KbTableName;
  sourceId: string;
  targetTable: KbTableName;
  targetId: string;
  linkType: KnowledgeLinkType;
  // 显式标注来源：默认 manual；AI 审核通过后调用方传 "ai" 并附带置信度/理由。
  origin?: Extract<KnowledgeLinkSource, "manual" | "ai">;
  aiConfidence?: number;
  aiReason?: string;
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

  const stored = await readStoredLinks();
  const origin: Extract<KnowledgeLinkSource, "manual" | "ai"> =
    input.origin ?? "manual";
  const next: KnowledgeLink = {
    id: buildLinkId(),
    sourceTable: input.sourceTable,
    sourceId,
    targetTable: input.targetTable,
    targetId,
    linkType: input.linkType,
    createdAt: new Date().toISOString(),
    source: origin,
    aiConfidence: origin === "ai" ? input.aiConfidence : undefined,
    aiReason: origin === "ai" ? input.aiReason : undefined,
  };

  const existingLinks = await listKnowledgeLinks();
  const duplicate = existingLinks.find(
    (link) => linkSignature(link) === linkSignature(next),
  );
  if (duplicate) {
    return duplicate;
  }

  await writeStoredLinks([...stored, next]);
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
  const [storedLinks, derivedLinks] = await Promise.all([
    readStoredLinks(),
    buildDerivedLinks(),
  ]);
  const existingSignatures = new Set(storedLinks.map((link) => linkSignature(link)));
  const seeded: KnowledgeLink[] = [];

  for (const link of derivedLinks) {
    if (existingSignatures.has(linkSignature(link))) continue;
    seeded.push({
      ...link,
      id: buildLinkId(),
      createdAt: new Date().toISOString(),
      source: "manual",
    });
  }

  if (seeded.length > 0) {
    await writeStoredLinks([...storedLinks, ...seeded]);
  }

  return {
    added: seeded.length,
    totalManual: storedLinks.length + seeded.length,
  };
}

/**
 * 对外暴露"所有已持久化的链路签名"，供 suggester 做去重判断。
 * 返回值形如 `rules::R-0001::consensus::C-0003::supports`。
 */
export async function listStoredLinkSignatures(): Promise<Set<string>> {
  const [stored, derived] = await Promise.all([readStoredLinks(), buildDerivedLinks()]);
  return new Set([...stored, ...derived].map((link) => linkSignature(link)));
}

/**
 * 无向配对签名：忽略方向与 linkType，用于 blocklist/去重。
 */
export function pairSignature(
  a: { table: KbTableName; id: string },
  b: { table: KbTableName; id: string },
) {
  const left = `${a.table}::${a.id}`;
  const right = `${b.table}::${b.id}`;
  return left < right ? `${left}||${right}` : `${right}||${left}`;
}
