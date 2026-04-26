import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { KbTableName } from "@/lib/kb-schema";
import { getRedis, isRedisConfigured } from "@/lib/redis-client";

type Row = Record<string, string>;

export type KnowledgeTagEntry = {
  table: KbTableName;
  id: string;
  label: string;
};

export type KnowledgeTagIndex = Record<string, KnowledgeTagEntry[]>;

const TAG_INDEX_KEY = "audit:kb:tag-index";
const TABLES: KbTableName[] = [
  "rules",
  "consensus",
  "external-purchases",
  "old-items",
  "operations",
  "production-checks",
  "faq",
];

function resolveDataDir() {
  const candidates = [
    resolve(process.cwd(), "data"),
    resolve(process.cwd(), "../../data"),
    resolve(process.cwd(), "../../../data"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

function getTagIndexFilePath() {
  return resolve(resolveDataDir(), "knowledge-tag-index.json");
}

async function ensureTagIndexFile() {
  const dataDir = resolveDataDir();
  const filePath = getTagIndexFilePath();
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
  if (!existsSync(filePath)) {
    await writeFile(filePath, "{}\n", "utf-8");
  }
}

function idField(table: KbTableName) {
  if (table === "rules") return "rule_id";
  if (table === "consensus") return "consensus_id";
  if (table === "operations") return "op_id";
  if (table === "production-checks") return "check_id";
  if (table === "faq") return "faq_id";
  return "item_id";
}

function primaryField(table: KbTableName) {
  if (table === "rules") return "条款标题";
  if (table === "consensus" || table === "operations") return "标题";
  if (table === "production-checks") return "产品名称";
  if (table === "faq") return "问题";
  return "物品名称";
}

export function normalizeTags(raw: string | undefined | null) {
  return [
    ...new Set(
      (raw || "")
        .split(/[，,、；;\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

export function stringifyTags(tags: string[]) {
  return normalizeTags(tags.join(",")).join(",");
}

function buildLabel(table: KbTableName, row: Row) {
  const id = row[idField(table)]?.trim() || "-";
  const primary = row[primaryField(table)]?.trim();
  if (table === "rules") {
    const clauseNo = row["条款编号"]?.trim();
    return [id, clauseNo, primary].filter(Boolean).join("｜");
  }
  return [id, primary].filter(Boolean).join("｜");
}

function parseStoredIndex(raw: unknown): KnowledgeTagIndex {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const parsed = raw as Record<string, unknown>;
  const index: KnowledgeTagIndex = {};
  for (const [tag, entries] of Object.entries(parsed)) {
    if (!Array.isArray(entries)) continue;
    index[tag] = entries
      .map((entry) => {
        const value = entry as Partial<KnowledgeTagEntry>;
        if (!value?.table || !value?.id) return null;
        return {
          table: value.table as KbTableName,
          id: value.id,
          label: value.label || value.id,
        };
      })
      .filter((entry): entry is KnowledgeTagEntry => Boolean(entry));
  }
  return index;
}

async function writeTagIndex(index: KnowledgeTagIndex) {
  if (isRedisConfigured()) {
    try {
      const redis = await getRedis();
      await redis.set(TAG_INDEX_KEY, index);
      return;
    } catch (error) {
      console.warn(
        "[knowledge-tags] failed to persist tag index to redis, fallback to file",
        error,
      );
    }
  }

  await ensureTagIndexFile();
  await writeFile(
    getTagIndexFilePath(),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf-8",
  );
}

async function readPersistedTagIndex(): Promise<KnowledgeTagIndex> {
  if (isRedisConfigured()) {
    try {
      const redis = await getRedis();
      return parseStoredIndex(await redis.get(TAG_INDEX_KEY));
    } catch (error) {
      console.warn(
        "[knowledge-tags] failed to read tag index from redis, fallback to file",
        error,
      );
    }
  }

  await ensureTagIndexFile();
  const raw = await readFile(getTagIndexFilePath(), "utf-8").catch(() => "{}");
  try {
    return parseStoredIndex(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function rebuildKnowledgeTagIndex() {
  const { readRows } = await import("@/lib/knowledge-store");
  const index: KnowledgeTagIndex = {};

  for (const table of TABLES) {
    const rows = await readRows(table);
    for (const row of rows) {
      const tags = normalizeTags(row.tags);
      const id = row[idField(table)]?.trim();
      if (!id || tags.length === 0) continue;
      const entry = { table, id, label: buildLabel(table, row) };
      for (const tag of tags) {
        const bucket = index[tag] ?? [];
        bucket.push(entry);
        index[tag] = bucket;
      }
    }
  }

  await writeTagIndex(index);
  return index;
}

export async function getKnowledgeTagIndex(options?: { forceRebuild?: boolean }) {
  if (options?.forceRebuild) {
    return rebuildKnowledgeTagIndex();
  }

  const existing = await readPersistedTagIndex();
  if (Object.keys(existing).length > 0) {
    return existing;
  }
  return rebuildKnowledgeTagIndex();
}

export async function listKnowledgeTags() {
  const index = await getKnowledgeTagIndex();
  return Object.entries(index)
    .map(([tag, entries]) => ({
      tag,
      count: entries.length,
      entries,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag, "zh-CN");
    });
}

export async function listEntriesByTag(tag: string) {
  const normalized = tag.trim();
  if (!normalized) return [];
  const index = await getKnowledgeTagIndex();
  return index[normalized] ?? [];
}
