import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getRedis, isRedisConfigured } from "@/lib/redis-client";
import type {
  ExternalPurchaseRequest,
  OldItemRequest,
  RegularQuestionRequest,
  ReviewTask,
  ReviewTaskStatus,
  ReviewTaskType,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Storage backend detection                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Redis key schema (v2 – per-task keys + sorted-set index)           */
/* ------------------------------------------------------------------ */

const IDX_ALL = "audit:review-task-ids";
const LEGACY_KEY = "audit:review-tasks";

export type ReviewStorageMode = "redis-only" | "file-only";

export type ReviewRepairSource = "auto" | "redis" | "legacy" | "file";

export type ReviewStorageDiagnostics = {
  mode: ReviewStorageMode;
  fileCount: number;
  redisConfigured: boolean;
  redisTaskKeyCount: number;
  redisIndexCount: number;
  redisRequesterBucketCount: number;
  legacyTaskCount: number;
};

export type ReviewRepairReport = {
  mode: ReviewStorageMode;
  source: Exclude<ReviewRepairSource, "auto">;
  totalTasks: number;
  indexedTasks: number;
  requesterBuckets: number;
};

function taskKey(id: string) {
  return `audit:review-task:${id}`;
}

function requesterIdx(requesterId: string) {
  return `audit:requester-tasks:${requesterId}`;
}

function isoToScore(iso: string) {
  return new Date(iso).getTime();
}

function getReviewStorageMode(): ReviewStorageMode {
  return isRedisConfigured() ? "redis-only" : "file-only";
}

/* ------------------------------------------------------------------ */
/*  File-based storage (local dev fallback – unchanged)                */
/* ------------------------------------------------------------------ */

function resolveDataDir() {
  const candidates = [
    resolve(process.cwd(), "data"),
    resolve(process.cwd(), "../../data"),
    resolve(process.cwd(), "../../../data"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

function getReviewFilePath() {
  return resolve(resolveDataDir(), "review-tasks.json");
}

function parseReviewTask(raw: unknown, source: string): ReviewTask | null {
  try {
    const task =
      typeof raw === "string" ? (JSON.parse(raw) as ReviewTask) : (raw as ReviewTask);
    return task?.id ? task : null;
  } catch (error) {
    console.warn(`[review-pool] skip invalid task from ${source}`, error);
    return null;
  }
}

async function ensureReviewFile() {
  const dataDir = resolveDataDir();
  const reviewFilePath = getReviewFilePath();
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
  if (!existsSync(reviewFilePath)) {
    await writeFile(reviewFilePath, "[]\n", "utf-8");
  }
}

async function readFromFile(): Promise<ReviewTask[]> {
  await ensureReviewFile();
  const reviewFilePath = getReviewFilePath();
  const raw = await readFile(reviewFilePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item, index) => parseReviewTask(item, `file:${index}`))
      .filter((item): item is ReviewTask => Boolean(item));
  } catch (error) {
    console.warn("[review-pool] failed to parse review file", error);
    return [];
  }
}

async function writeToFile(tasks: ReviewTask[]) {
  await ensureReviewFile();
  const reviewFilePath = getReviewFilePath();
  await writeFile(reviewFilePath, `${JSON.stringify(tasks, null, 2)}\n`, "utf-8");
}

/* ------------------------------------------------------------------ */
/*  Redis v2 – individual key operations                               */
/* ------------------------------------------------------------------ */

let migrationDone = false;

async function scanRedisKeys(match: string) {
  const redis = await getRedis();
  const keys: string[] = [];
  let cursor = "0";

  do {
    const [nextCursor, batch] = await redis.scan(cursor, {
      match,
      count: 200,
    });
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");

  return keys;
}

async function listRedisTaskKeyIds() {
  const keys = await scanRedisKeys(`${taskKey("*")}`);
  return keys
    .map((key) => key.slice(taskKey("").length))
    .filter((id) => id && !id.includes("*"));
}

async function listRedisRequesterBucketKeys() {
  return scanRedisKeys(`${requesterIdx("*")}`);
}

async function getLegacyRedisTasks() {
  const redis = await getRedis();
  const legacy = await redis.get<ReviewTask[]>(LEGACY_KEY);
  return Array.isArray(legacy)
    ? legacy
        .map((task, index) => parseReviewTask(task, `legacy:${index}`))
        .filter((task): task is ReviewTask => Boolean(task))
    : [];
}

function dedupeReviewTasks(tasks: ReviewTask[]) {
  const byId = new Map<string, ReviewTask>();
  for (const task of tasks) {
    if (!task?.id) continue;
    if (!byId.has(task.id)) {
      byId.set(task.id, task);
      continue;
    }
    const existing = byId.get(task.id)!;
    byId.set(
      task.id,
      safeCreatedAt(task).localeCompare(safeCreatedAt(existing)) >= 0 ? task : existing,
    );
  }
  return [...byId.values()].sort((a, b) =>
    safeCreatedAt(b).localeCompare(safeCreatedAt(a)),
  );
}

async function writeTasksToRedis(
  tasks: ReviewTask[],
  options: { clearTaskKeys: boolean },
) {
  const redis = await getRedis();
  const requesterKeys = await listRedisRequesterBucketKeys();
  const pipeline = redis.pipeline();

  pipeline.del(IDX_ALL);
  for (const key of requesterKeys) {
    pipeline.del(key);
  }

  if (options.clearTaskKeys) {
    const taskKeys = await scanRedisKeys(`${taskKey("*")}`);
    for (const key of taskKeys) {
      pipeline.del(key);
    }
  }

  const requesterIds = new Set<string>();
  for (const task of tasks) {
    if (!task?.id) continue;
    pipeline.set(taskKey(task.id), JSON.stringify(task));
    pipeline.zadd(IDX_ALL, {
      score: isoToScore(task.createdAt || new Date().toISOString()),
      member: task.id,
    });
    if (task.requesterId?.trim()) {
      requesterIds.add(task.requesterId.trim());
      pipeline.sadd(requesterIdx(task.requesterId.trim()), task.id);
    }
  }

  await pipeline.exec();
  return {
    totalTasks: tasks.length,
    indexedTasks: tasks.filter((task) => Boolean(task?.id)).length,
    requesterBuckets: requesterIds.size,
  };
}

async function collectReviewTasksFromRedisKeys() {
  const ids = await listRedisTaskKeyIds();
  const tasks = await redisGetMany(ids);
  return tasks.sort((a, b) => safeCreatedAt(b).localeCompare(safeCreatedAt(a)));
}

async function ensureMigrated() {
  if (migrationDone || getReviewStorageMode() !== "redis-only") return;
  migrationDone = true;

  try {
    const redis = await getRedis();
    const indexCount = await redis.zcard(IDX_ALL);
    if (indexCount > 0) return;

    const redisTasks = await collectReviewTasksFromRedisKeys();
    if (redisTasks.length > 0) {
      await writeTasksToRedis(redisTasks, { clearTaskKeys: false });
    }
  } catch (err) {
    console.warn("[review-pool] ensureMigrated failed, continuing anyway", err);
  }
}

async function redisAddTask(task: ReviewTask) {
  await ensureMigrated();
  const redis = await getRedis();
  const pipeline = redis.pipeline();
  pipeline.set(taskKey(task.id), JSON.stringify(task));
  pipeline.zadd(IDX_ALL, {
    score: isoToScore(task.createdAt),
    member: task.id,
  });
  if (task.requesterId?.trim()) {
    pipeline.sadd(requesterIdx(task.requesterId), task.id);
  }
  await pipeline.exec();
}

async function redisGetTask(id: string): Promise<ReviewTask | null> {
  await ensureMigrated();
  const redis = await getRedis();
  const raw = await redis.get<string>(taskKey(id));
  if (!raw) return null;
  return parseReviewTask(raw, `redis:${id}`);
}

async function redisUpdateTask(
  id: string,
  patch: Partial<ReviewTask>,
): Promise<ReviewTask | null> {
  await ensureMigrated();
  const current = await redisGetTask(id);
  if (!current) return null;

  const updated: ReviewTask = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  const redis = await getRedis();
  await redis.set(taskKey(id), JSON.stringify(updated));
  return updated;
}

async function redisListIds(requesterId?: string): Promise<string[]> {
  await ensureMigrated();
  const redis = await getRedis();

  try {
    if (requesterId) {
      return (await redis.smembers(requesterIdx(requesterId))) as string[];
    }
    return (await redis.zrange(IDX_ALL, 0, -1, { rev: true })) as string[];
  } catch (err) {
    console.warn("[review-pool] redisListIds failed", err);
    return [];
  }
}

async function redisGetMany(ids: string[]): Promise<ReviewTask[]> {
  if (ids.length === 0) return [];
  const redis = await getRedis();

  const BATCH = 100;
  const tasks: ReviewTask[] = [];

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    try {
      const pipeline = redis.pipeline();
      for (const id of batch) {
        pipeline.get(taskKey(id));
      }
      const results = await pipeline.exec();
      for (let index = 0; index < results.length; index += 1) {
        const raw = results[index];
        if (!raw) continue;
        const task = parseReviewTask(raw, `redis-batch:${batch[index]}`);
        if (task?.id) tasks.push(task);
      }
    } catch (err) {
      console.warn(`[review-pool] redisGetMany batch error at offset ${i}`, err);
    }
  }

  return tasks;
}

async function listReviewTasksFromFile(requesterId?: string) {
  const tasks = await readFromFile();
  const filtered = requesterId
    ? tasks.filter((t) => t.requesterId === requesterId)
    : tasks;
  return filtered.sort((a, b) => safeCreatedAt(b).localeCompare(safeCreatedAt(a)));
}

/* ------------------------------------------------------------------ */
/*  Unified CRUD                                                       */
/* ------------------------------------------------------------------ */

async function persistNewTask(task: ReviewTask) {
  if (getReviewStorageMode() === "redis-only") {
    await redisAddTask(task);
    return task;
  }
  const tasks = await readFromFile();
  tasks.unshift(task);
  await writeToFile(tasks);
  return task;
}

export function isRequesterReplyReady(task: ReviewTask) {
  if (task.status === "待补充") {
    return true;
  }

  if (task.status === "已处理" || task.status === "已加入知识库") {
    return true;
  }

  return Boolean(task.finalConclusion?.trim() || task.finalExplanation?.trim());
}

export function hasUnreadRequesterReply(task: ReviewTask) {
  if (!isRequesterReplyReady(task) || !task.replyPublishedAt) {
    return false;
  }

  const replyAt = Date.parse(task.replyPublishedAt);
  const viewedAt = task.requesterLastViewedAt
    ? Date.parse(task.requesterLastViewedAt)
    : 0;

  if (!Number.isFinite(replyAt)) {
    return false;
  }

  return !Number.isFinite(viewedAt) || replyAt > viewedAt;
}

function safeCreatedAt(t: ReviewTask): string {
  return typeof t?.createdAt === "string" ? t.createdAt : "";
}

export async function listReviewTasks(filters?: { requesterId?: string }) {
  const requesterId = filters?.requesterId?.trim();

  if (getReviewStorageMode() === "redis-only") {
    await ensureMigrated();
    const ids = await redisListIds(requesterId);
    const tasks = await redisGetMany(ids);
    return tasks.sort((a, b) => safeCreatedAt(b).localeCompare(safeCreatedAt(a)));
  }

  try {
    return await listReviewTasksFromFile(requesterId);
  } catch (err) {
    console.error("[review-pool] listReviewTasks file path crashed, returning []", err);
    return [];
  }
}

export async function getReviewTaskById(
  id: string,
  filters?: { requesterId?: string },
) {
  try {
    if (getReviewStorageMode() === "redis-only") {
      await ensureMigrated();
      const task = await redisGetTask(id);
      if (!task) return null;
      const requesterId = filters?.requesterId?.trim();
      if (requesterId && task.requesterId !== requesterId) return null;
      return task;
    }

    const tasks = await listReviewTasks(filters);
    return tasks.find((t) => t.id === id) || null;
  } catch (err) {
    console.error("[review-pool] getReviewTaskById crashed", err);
    return null;
  }
}

export async function updateReviewTask(
  id: string,
  payload: Partial<ReviewTask> & { status?: ReviewTaskStatus },
) {
  if (getReviewStorageMode() === "redis-only") {
    return redisUpdateTask(id, payload);
  }

  const tasks = await readFromFile();
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const updated: ReviewTask = {
    ...tasks[index],
    ...payload,
    updatedAt: new Date().toISOString(),
  };
  tasks[index] = updated;
  await writeToFile(tasks);
  return updated;
}

export async function markReviewTaskRequesterRead(id: string) {
  return updateReviewTask(id, {
    requesterLastViewedAt: new Date().toISOString(),
  });
}

export async function getReviewSummary() {
  try {
    const tasks = await listReviewTasks();
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === "待处理").length,
      needMoreInfo: tasks.filter((t) => t.status === "待补充").length,
      completed: tasks.filter((t) => t.status === "已处理").length,
      latest: tasks.slice(0, 5),
    };
  } catch {
    return { total: 0, pending: 0, needMoreInfo: 0, completed: 0, latest: [] };
  }
}

export function getStorageBackend() {
  return getReviewStorageMode() === "redis-only" ? "redis" : "local-file";
}

export async function getReviewStorageDiagnostics(): Promise<ReviewStorageDiagnostics> {
  const mode = getReviewStorageMode();
  const fileTasks = await readFromFile();

  if (mode === "file-only") {
    return {
      mode,
      fileCount: fileTasks.length,
      redisConfigured: false,
      redisTaskKeyCount: 0,
      redisIndexCount: 0,
      redisRequesterBucketCount: 0,
      legacyTaskCount: 0,
    };
  }

  try {
    const redis = await getRedis();
    const [redisTaskKeys, requesterBucketKeys, redisIndexCount, legacyTasks] =
      await Promise.all([
        listRedisTaskKeyIds(),
        listRedisRequesterBucketKeys(),
        redis.zcard(IDX_ALL),
        getLegacyRedisTasks(),
      ]);

    return {
      mode,
      fileCount: fileTasks.length,
      redisConfigured: true,
      redisTaskKeyCount: redisTaskKeys.length,
      redisIndexCount,
      redisRequesterBucketCount: requesterBucketKeys.length,
      legacyTaskCount: legacyTasks.length,
    };
  } catch (error) {
    console.warn("[review-pool] diagnostics failed to query redis", error);
    return {
      mode,
      fileCount: fileTasks.length,
      redisConfigured: true,
      redisTaskKeyCount: 0,
      redisIndexCount: 0,
      redisRequesterBucketCount: 0,
      legacyTaskCount: 0,
    };
  }
}

export async function repairReviewTaskStorage(
  source: ReviewRepairSource = "auto",
): Promise<ReviewRepairReport> {
  const mode = getReviewStorageMode();
  if (mode !== "redis-only") {
    const fileTasks = await readFromFile();
    return {
      mode,
      source: "file",
      totalTasks: fileTasks.length,
      indexedTasks: fileTasks.length,
      requesterBuckets: new Set(
        fileTasks.map((task) => task.requesterId?.trim()).filter(Boolean),
      ).size,
    };
  }

  let selectedSource: Exclude<ReviewRepairSource, "auto"> =
    source === "legacy" ? "legacy" : source === "file" ? "file" : "redis";
  const redisTasks = await collectReviewTasksFromRedisKeys();
  let tasks: ReviewTask[] = [];

  if (source === "auto" || source === "redis") {
    selectedSource = "redis";
    tasks = redisTasks;
  } else if (source === "legacy") {
    selectedSource = "legacy";
    tasks = dedupeReviewTasks([...redisTasks, ...(await getLegacyRedisTasks())]);
  } else if (source === "file") {
    selectedSource = "file";
    tasks = dedupeReviewTasks([...redisTasks, ...(await readFromFile())]);
  }

  if (selectedSource === "redis") {
    if (tasks.length === 0) {
      return {
        mode,
        source: selectedSource,
        totalTasks: 0,
        indexedTasks: 0,
        requesterBuckets: 0,
      };
    }
    const result = await writeTasksToRedis(tasks, {
      clearTaskKeys: false,
    });
    return {
      mode,
      source: selectedSource,
      ...result,
    };
  }

  const result = await writeTasksToRedis(tasks, {
    clearTaskKeys: false,
  });

  return {
    mode,
    source: selectedSource,
    ...result,
  };
}

/* ------------------------------------------------------------------ */
/*  Task creation helpers                                              */
/* ------------------------------------------------------------------ */

function buildId() {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const random = Math.floor(Math.random() * 900 + 100);
  return `RV-${stamp}-${random}`;
}

function normalizeRequester(params: { requesterId?: string; requesterName?: string }) {
  const requesterId = params.requesterId?.trim();
  const requesterName = params.requesterName?.trim();
  return {
    requesterId,
    requester: requesterName || requesterId || "当前用户",
  };
}

function createBaseTask(params: {
  type: ReviewTaskType;
  requesterId?: string;
  requesterName?: string;
  requester?: string;
  storeCode?: string;
  category?: string;
  selfJudgment?: string;
  description?: string;
  imageNotes?: string;
  rejectReason: string;
  sourcePayload: object;
}) {
  const now = new Date().toISOString();
  const requester = normalizeRequester({
    requesterId: params.requesterId,
    requesterName: params.requesterName || params.requester,
  });
  const task: ReviewTask = {
    id: buildId(),
    type: params.type,
    status: "待处理",
    createdAt: now,
    updatedAt: now,
    replyPublishedAt: "",
    requesterLastViewedAt: "",
    requesterId: requester.requesterId,
    requester: requester.requester,
    storeCode: params.storeCode || "-",
    category: params.category || "-",
    selfJudgment: params.selfJudgment || "-",
    description: params.description || "-",
    imageNotes: params.imageNotes || "-",
    rejectReason: params.rejectReason,
    finalConclusion: "",
    finalScore: "",
    finalClause: "",
    finalExplanation: "",
    processor: "",
    sourcePayload: JSON.stringify(params.sourcePayload, null, 2),
  };
  return task;
}

export async function createReviewTask(params: {
  type: ReviewTaskType;
  requesterId?: string;
  requesterName?: string;
  requester?: string;
  storeCode?: string;
  category?: string;
  selfJudgment?: string;
  description?: string;
  imageNotes?: string;
  rejectReason: string;
  sourcePayload: object;
}) {
  return persistNewTask(createBaseTask(params));
}

export async function createReviewTaskFromAnswer(params: {
  type: ReviewTaskType;
  request: RegularQuestionRequest | ExternalPurchaseRequest | OldItemRequest;
  answer: object;
  aiExplanation?: string;
  matchingDebug?: object;
  storeCode?: string;
  category?: string;
  selfJudgment?: string;
  description?: string;
}) {
  const req = params.request as RegularQuestionRequest &
    ExternalPurchaseRequest &
    OldItemRequest;
  const now = new Date().toISOString();
  const reqNorm = normalizeRequester({
    requesterId: req.requesterId,
    requesterName: req.requesterName,
  });
  const task: ReviewTask = {
    id: buildId(),
    type: params.type,
    status: "AI已自动回答",
    createdAt: now,
    updatedAt: now,
    replyPublishedAt: "",
    requesterLastViewedAt: "",
    requesterId: reqNorm.requesterId,
    requester: reqNorm.requester,
    storeCode: params.storeCode || req.storeCode || "-",
    category: params.category || req.category || "-",
    selfJudgment: params.selfJudgment || req.selfJudgment || "-",
    description:
      params.description || req.description || req.issueTitle || req.name || "-",
    imageNotes: "-",
    rejectReason: "-",
    finalConclusion: "",
    finalScore: "",
    finalClause: "",
    finalExplanation: "",
    processor: "",
    sourcePayload: JSON.stringify(
      {
        request: params.request,
        autoAnswer: params.answer,
        aiExplanation: params.aiExplanation,
        matchingDebug: params.matchingDebug,
      },
      null,
      2,
    ),
  };
  return persistNewTask(task);
}

export async function createReviewTaskFromRegularQuestion(
  request: RegularQuestionRequest,
  rejectReason: string,
  matchingDebug?: object,
) {
  return createReviewTask({
    type: "常规问题",
    requesterId: request.requesterId,
    requesterName: request.requesterName,
    storeCode: request.storeCode,
    category: request.category,
    selfJudgment: request.selfJudgment,
    description: request.description || request.issueTitle,
    rejectReason,
    sourcePayload: {
      request,
      matchingDebug,
    },
  });
}

export async function createReviewTaskFromExternalPurchase(
  request: ExternalPurchaseRequest,
  rejectReason: string,
) {
  return createReviewTask({
    type: "外购查询",
    requesterId: request.requesterId,
    requesterName: request.requesterName,
    category: "外购与非认可物料/器具",
    description: [request.name, request.description].filter(Boolean).join("｜"),
    rejectReason,
    sourcePayload: request,
  });
}

export async function createReviewTaskFromOldItem(
  request: OldItemRequest,
  rejectReason: string,
) {
  return createReviewTask({
    type: "旧品比对",
    requesterId: request.requesterId,
    requesterName: request.requesterName,
    category: "旧品比对",
    description: [request.name, request.remark].filter(Boolean).join("｜"),
    rejectReason,
    sourcePayload: request,
  });
}
