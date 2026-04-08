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

function taskKey(id: string) {
  return `audit:review-task:${id}`;
}

function requesterIdx(requesterId: string) {
  return `audit:requester-tasks:${requesterId}`;
}

function isoToScore(iso: string) {
  return new Date(iso).getTime();
}

/* ------------------------------------------------------------------ */
/*  File-based storage (local dev fallback – unchanged)                */
/* ------------------------------------------------------------------ */

const dataDir = resolve(process.cwd(), "../../data");
const reviewFilePath = resolve(dataDir, "review-tasks.json");

async function ensureReviewFile() {
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
  if (!existsSync(reviewFilePath)) {
    await writeFile(reviewFilePath, "[]\n", "utf-8");
  }
}

async function readFromFile(): Promise<ReviewTask[]> {
  await ensureReviewFile();
  const raw = await readFile(reviewFilePath, "utf-8");
  return JSON.parse(raw) as ReviewTask[];
}

async function writeToFile(tasks: ReviewTask[]) {
  await ensureReviewFile();
  await writeFile(reviewFilePath, `${JSON.stringify(tasks, null, 2)}\n`, "utf-8");
}

/* ------------------------------------------------------------------ */
/*  Redis v2 – individual key operations                               */
/* ------------------------------------------------------------------ */

let migrationDone = false;

async function ensureMigrated() {
  if (migrationDone) return;
  migrationDone = true;

  const redis = await getRedis();
  const existsNew = await redis.exists(IDX_ALL);
  if (existsNew) return;

  const legacy = await redis.get<ReviewTask[]>(LEGACY_KEY);
  if (!legacy || !Array.isArray(legacy) || legacy.length === 0) return;

  const pipeline = redis.pipeline();
  for (const task of legacy) {
    pipeline.set(taskKey(task.id), JSON.stringify(task));
    pipeline.zadd(IDX_ALL, {
      score: isoToScore(task.createdAt),
      member: task.id,
    });
    if (task.requesterId?.trim()) {
      pipeline.sadd(requesterIdx(task.requesterId), task.id);
    }
  }
  await pipeline.exec();
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
  return typeof raw === "string"
    ? (JSON.parse(raw) as ReviewTask)
    : (raw as unknown as ReviewTask);
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

  if (requesterId) {
    return (await redis.smembers(requesterIdx(requesterId))) as string[];
  }

  return (await redis.zrange(IDX_ALL, 0, -1, { rev: true })) as string[];
}

async function redisGetMany(ids: string[]): Promise<ReviewTask[]> {
  if (ids.length === 0) return [];
  const redis = await getRedis();

  const BATCH = 100;
  const tasks: ReviewTask[] = [];

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const pipeline = redis.pipeline();
    for (const id of batch) {
      pipeline.get(taskKey(id));
    }
    const results = await pipeline.exec();
    for (const raw of results) {
      if (!raw) continue;
      const task =
        typeof raw === "string"
          ? (JSON.parse(raw) as ReviewTask)
          : (raw as unknown as ReviewTask);
      if (task?.id) tasks.push(task);
    }
  }

  return tasks;
}

/* ------------------------------------------------------------------ */
/*  Unified CRUD                                                       */
/* ------------------------------------------------------------------ */

async function persistNewTask(task: ReviewTask) {
  if (isRedisConfigured()) {
    await redisAddTask(task);
  } else {
    const tasks = await readFromFile();
    tasks.unshift(task);
    await writeToFile(tasks);
  }
  return task;
}

export async function listReviewTasks(filters?: { requesterId?: string }) {
  const requesterId = filters?.requesterId?.trim();

  if (isRedisConfigured()) {
    const ids = await redisListIds(requesterId);
    const tasks = await redisGetMany(ids);
    return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const tasks = await readFromFile();
  const filtered = requesterId
    ? tasks.filter((t) => t.requesterId === requesterId)
    : tasks;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getReviewTaskById(
  id: string,
  filters?: { requesterId?: string },
) {
  if (isRedisConfigured()) {
    const task = await redisGetTask(id);
    if (!task) return null;
    const requesterId = filters?.requesterId?.trim();
    if (requesterId && task.requesterId !== requesterId) return null;
    return task;
  }

  const tasks = await listReviewTasks(filters);
  return tasks.find((t) => t.id === id) || null;
}

export async function updateReviewTask(
  id: string,
  payload: Partial<ReviewTask> & { status?: ReviewTaskStatus },
) {
  if (isRedisConfigured()) {
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

export async function getReviewSummary() {
  const tasks = await listReviewTasks();
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "待处理").length,
    needMoreInfo: tasks.filter((t) => t.status === "待补充").length,
    completed: tasks.filter((t) => t.status === "已处理").length,
    latest: tasks.slice(0, 5),
  };
}

export function getStorageBackend() {
  return isRedisConfigured() ? "upstash-redis" : "local-file";
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
    sourcePayload: request,
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
