import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { KbTableName } from "@/lib/kb-schema";
import type { KnowledgeLinkType } from "@/lib/knowledge-links";
import { pairSignature } from "@/lib/knowledge-links";
import { getRedis, isRedisConfigured } from "@/lib/redis-client";

export type LinkSuggestionStatus = "pending" | "approved" | "rejected" | "skipped";

export type LinkSuggestion = {
  id: string;
  sourceTable: KbTableName;
  sourceId: string;
  targetTable: KbTableName;
  targetId: string;
  linkType: KnowledgeLinkType;
  confidence: number;
  reason: string;
  evidenceSourceSpan: string;
  evidenceTargetSpan: string;
  model: string;
  status: LinkSuggestionStatus;
  createdAt: string;
  updatedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  // 采纳后回填：指向 knowledge-links 里的记录 id。
  appliedLinkId?: string;
};

const SUGGESTIONS_REDIS_KEY = "audit:kb:link-suggestions";
const BLOCKLIST_REDIS_KEY = "audit:kb:link-blocklist";
const SUGGESTIONS_FILE = "knowledge-link-suggestions.json";
const BLOCKLIST_FILE = "knowledge-link-blocklist.json";

const SUPPORTED_TABLES: KbTableName[] = [
  "rules",
  "consensus",
  "external-purchases",
  "old-items",
  "operations",
];
const SUPPORTED_LINK_TYPES: KnowledgeLinkType[] = [
  "references",
  "supports",
  "related",
  "supersedes",
  "contradicts",
];
const SUPPORTED_STATUSES: LinkSuggestionStatus[] = [
  "pending",
  "approved",
  "rejected",
  "skipped",
];

function resolveDataDir() {
  const candidates = [
    resolve(/* turbopackIgnore: true */ process.cwd(), "data"),
    resolve(/* turbopackIgnore: true */ process.cwd(), "../../data"),
    resolve(/* turbopackIgnore: true */ process.cwd(), "../../../data"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

async function ensureFile(filename: string, emptyPayload: string) {
  const dataDir = resolveDataDir();
  const filePath = resolve(dataDir, filename);
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
  if (!existsSync(filePath)) {
    await writeFile(filePath, emptyPayload, "utf-8");
  }
  return filePath;
}

function parseSuggestion(raw: unknown): LinkSuggestion | null {
  const v = raw as Partial<LinkSuggestion> | null;
  if (!v?.id || !v.sourceId || !v.targetId) return null;
  if (
    !SUPPORTED_TABLES.includes(v.sourceTable as KbTableName) ||
    !SUPPORTED_TABLES.includes(v.targetTable as KbTableName)
  ) {
    return null;
  }
  if (!SUPPORTED_LINK_TYPES.includes(v.linkType as KnowledgeLinkType)) {
    return null;
  }
  const status = SUPPORTED_STATUSES.includes(v.status as LinkSuggestionStatus)
    ? (v.status as LinkSuggestionStatus)
    : "pending";
  return {
    id: v.id,
    sourceTable: v.sourceTable as KbTableName,
    sourceId: v.sourceId,
    targetTable: v.targetTable as KbTableName,
    targetId: v.targetId,
    linkType: v.linkType as KnowledgeLinkType,
    confidence:
      typeof v.confidence === "number" && Number.isFinite(v.confidence)
        ? Math.min(1, Math.max(0, v.confidence))
        : 0,
    reason: typeof v.reason === "string" ? v.reason : "",
    evidenceSourceSpan:
      typeof v.evidenceSourceSpan === "string" ? v.evidenceSourceSpan : "",
    evidenceTargetSpan:
      typeof v.evidenceTargetSpan === "string" ? v.evidenceTargetSpan : "",
    model: typeof v.model === "string" ? v.model : "",
    status,
    createdAt: v.createdAt || new Date(0).toISOString(),
    updatedAt: v.updatedAt || v.createdAt || new Date(0).toISOString(),
    decidedBy: typeof v.decidedBy === "string" ? v.decidedBy : undefined,
    decidedAt: typeof v.decidedAt === "string" ? v.decidedAt : undefined,
    appliedLinkId: typeof v.appliedLinkId === "string" ? v.appliedLinkId : undefined,
  };
}

async function readAllSuggestions(): Promise<LinkSuggestion[]> {
  if (isRedisConfigured()) {
    try {
      const redis = await getRedis();
      const raw = await redis.get<unknown[]>(SUGGESTIONS_REDIS_KEY);
      if (!Array.isArray(raw)) return [];
      return raw.map(parseSuggestion).filter((x): x is LinkSuggestion => Boolean(x));
    } catch (err) {
      console.warn("[link-suggestions] read redis failed, falling back to file", err);
    }
  }
  const filePath = await ensureFile(SUGGESTIONS_FILE, "[]\n");
  const raw = await readFile(filePath, "utf-8").catch(() => "[]");
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseSuggestion).filter((x): x is LinkSuggestion => Boolean(x));
  } catch {
    return [];
  }
}

async function writeAllSuggestions(list: LinkSuggestion[]) {
  if (isRedisConfigured()) {
    try {
      const redis = await getRedis();
      await redis.set(SUGGESTIONS_REDIS_KEY, list);
      return;
    } catch (err) {
      console.warn("[link-suggestions] write redis failed, falling back to file", err);
    }
  }
  const filePath = await ensureFile(SUGGESTIONS_FILE, "[]\n");
  await writeFile(filePath, `${JSON.stringify(list, null, 2)}\n`, "utf-8");
}

async function readBlocklist(): Promise<Set<string>> {
  if (isRedisConfigured()) {
    try {
      const redis = await getRedis();
      const raw = await redis.get<string[]>(BLOCKLIST_REDIS_KEY);
      if (Array.isArray(raw)) return new Set(raw.filter((x) => typeof x === "string"));
    } catch (err) {
      console.warn("[link-suggestions] read blocklist failed", err);
    }
  }
  const filePath = await ensureFile(BLOCKLIST_FILE, "[]\n");
  const raw = await readFile(filePath, "utf-8").catch(() => "[]");
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

async function writeBlocklist(set: Set<string>) {
  const list = [...set];
  if (isRedisConfigured()) {
    try {
      const redis = await getRedis();
      await redis.set(BLOCKLIST_REDIS_KEY, list);
      return;
    } catch (err) {
      console.warn("[link-suggestions] write blocklist failed", err);
    }
  }
  const filePath = await ensureFile(BLOCKLIST_FILE, "[]\n");
  await writeFile(filePath, `${JSON.stringify(list, null, 2)}\n`, "utf-8");
}

export async function isPairBlocklisted(
  a: { table: KbTableName; id: string },
  b: { table: KbTableName; id: string },
): Promise<boolean> {
  const set = await readBlocklist();
  return set.has(pairSignature(a, b));
}

export async function addPairToBlocklist(
  a: { table: KbTableName; id: string },
  b: { table: KbTableName; id: string },
) {
  const set = await readBlocklist();
  set.add(pairSignature(a, b));
  await writeBlocklist(set);
}

export async function listBlocklistSignatures(): Promise<Set<string>> {
  return readBlocklist();
}

export async function listSuggestions(options?: {
  status?: LinkSuggestionStatus | "all";
  limit?: number;
  offset?: number;
}): Promise<{ items: LinkSuggestion[]; total: number }> {
  const all = await readAllSuggestions();
  const status = options?.status ?? "pending";
  const filtered = status === "all" ? all : all.filter((x) => x.status === status);
  const sorted = filtered.slice().sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return b.confidence - a.confidence;
  });
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? sorted.length;
  return {
    items: sorted.slice(offset, offset + limit),
    total: filtered.length,
  };
}

export async function listPendingSuggestionsForGraph(
  minConfidence: number,
): Promise<LinkSuggestion[]> {
  const all = await readAllSuggestions();
  return all.filter((x) => x.status === "pending" && x.confidence >= minConfidence);
}

function buildSuggestionId() {
  return `SG-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
}

type SuggestionDraft = Omit<
  LinkSuggestion,
  | "id"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "decidedBy"
  | "decidedAt"
  | "appliedLinkId"
>;

/**
 * 批量写入 pending 建议；自动跳过 blocklist / 已存在的同签名 pending 项。
 * 返回实际写入数量。
 */
export async function addSuggestions(drafts: SuggestionDraft[]) {
  if (drafts.length === 0) return { added: 0, total: 0 };
  const [current, blocklist] = await Promise.all([
    readAllSuggestions(),
    readBlocklist(),
  ]);

  const pendingPairs = new Set(
    current
      .filter((x) => x.status === "pending")
      .map((x) =>
        pairSignature(
          { table: x.sourceTable, id: x.sourceId },
          { table: x.targetTable, id: x.targetId },
        ),
      ),
  );

  const now = new Date().toISOString();
  const fresh: LinkSuggestion[] = [];
  for (const draft of drafts) {
    const pair = pairSignature(
      { table: draft.sourceTable, id: draft.sourceId },
      { table: draft.targetTable, id: draft.targetId },
    );
    if (blocklist.has(pair)) continue;
    if (pendingPairs.has(pair)) continue;
    pendingPairs.add(pair);
    fresh.push({
      ...draft,
      id: buildSuggestionId(),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  }

  if (fresh.length === 0) {
    return { added: 0, total: current.length };
  }

  const next = [...current, ...fresh];
  await writeAllSuggestions(next);
  return { added: fresh.length, total: next.length };
}

export async function getSuggestionById(id: string): Promise<LinkSuggestion | null> {
  const all = await readAllSuggestions();
  return all.find((x) => x.id === id) ?? null;
}

export async function updateSuggestionStatus(
  id: string,
  patch: {
    status: LinkSuggestionStatus;
    decidedBy?: string;
    appliedLinkId?: string;
  },
): Promise<LinkSuggestion | null> {
  const all = await readAllSuggestions();
  const idx = all.findIndex((x) => x.id === id);
  if (idx === -1) return null;
  const next: LinkSuggestion = {
    ...all[idx],
    status: patch.status,
    decidedBy: patch.decidedBy ?? all[idx].decidedBy,
    decidedAt: new Date().toISOString(),
    appliedLinkId: patch.appliedLinkId ?? all[idx].appliedLinkId,
    updatedAt: new Date().toISOString(),
  };
  const list = all.slice();
  list[idx] = next;
  await writeAllSuggestions(list);
  return next;
}

export async function expireDanglingSuggestions(
  isEntryValid: (table: KbTableName, id: string) => boolean,
): Promise<number> {
  const all = await readAllSuggestions();
  let changed = 0;
  const next = all.map((x) => {
    if (x.status !== "pending") return x;
    if (
      isEntryValid(x.sourceTable, x.sourceId) &&
      isEntryValid(x.targetTable, x.targetId)
    ) {
      return x;
    }
    changed += 1;
    return { ...x, status: "skipped" as const, updatedAt: new Date().toISOString() };
  });
  if (changed > 0) {
    await writeAllSuggestions(next);
  }
  return changed;
}

export async function countSuggestionsByStatus(): Promise<
  Record<LinkSuggestionStatus, number>
> {
  const all = await readAllSuggestions();
  const out: Record<LinkSuggestionStatus, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    skipped: 0,
  };
  for (const x of all) {
    out[x.status] += 1;
  }
  return out;
}
