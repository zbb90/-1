import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ExternalPurchaseRequest,
  OldItemRequest,
  RegularQuestionRequest,
  ReviewTask,
  ReviewTaskStatus,
  ReviewTaskType,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Storage backend: Upstash Redis (production) ↔ local JSON (dev)    */
/* ------------------------------------------------------------------ */

const REDIS_KEY = "audit:review-tasks";

function useRedis() {
  return Boolean(
    process.env.KV_REST_API_URL?.trim() &&
      process.env.KV_REST_API_TOKEN?.trim(),
  );
}

let redisInstance: import("@upstash/redis").Redis | null = null;

async function getRedis() {
  if (redisInstance) return redisInstance;
  const { Redis } = await import("@upstash/redis");
  redisInstance = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
  return redisInstance;
}

/* ---------- File-based (local dev fallback) ---------- */

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
  await writeFile(
    reviewFilePath,
    `${JSON.stringify(tasks, null, 2)}\n`,
    "utf-8",
  );
}

/* ---------- Redis-based (Vercel / production) ---------- */

async function readFromRedis(): Promise<ReviewTask[]> {
  const redis = await getRedis();
  const data = await redis.get<ReviewTask[]>(REDIS_KEY);
  return data ?? [];
}

async function writeToRedis(tasks: ReviewTask[]) {
  const redis = await getRedis();
  await redis.set(REDIS_KEY, JSON.stringify(tasks));
}

/* ---------- Unified read / write ---------- */

async function readReviewTasks(): Promise<ReviewTask[]> {
  return useRedis() ? readFromRedis() : readFromFile();
}

async function writeReviewTasks(tasks: ReviewTask[]) {
  return useRedis() ? writeToRedis(tasks) : writeToFile(tasks);
}

/* ------------------------------------------------------------------ */
/*  Business logic (unchanged)                                        */
/* ------------------------------------------------------------------ */

function buildId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = Math.floor(Math.random() * 900 + 100);
  return `RV-${stamp}-${random}`;
}

function normalizeRequester(params: {
  requesterId?: string;
  requesterName?: string;
}) {
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

async function persistNewTask(task: ReviewTask) {
  const tasks = await readReviewTasks();
  tasks.unshift(task);
  await writeReviewTasks(tasks);
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

export async function listReviewTasks(filters?: { requesterId?: string }) {
  const tasks = await readReviewTasks();
  const requesterId = filters?.requesterId?.trim();
  const filteredTasks = requesterId
    ? tasks.filter((task) => task.requesterId === requesterId)
    : tasks;

  return filteredTasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getReviewTaskById(
  id: string,
  filters?: { requesterId?: string },
) {
  const tasks = await listReviewTasks(filters);
  return tasks.find((task) => task.id === id) || null;
}

export async function getReviewSummary() {
  const tasks = await listReviewTasks();
  return {
    total: tasks.length,
    pending: tasks.filter((task) => task.status === "待处理").length,
    needMoreInfo: tasks.filter((task) => task.status === "待补充").length,
    completed: tasks.filter((task) => task.status === "已处理").length,
    latest: tasks.slice(0, 5),
  };
}

export async function updateReviewTask(
  id: string,
  payload: Partial<ReviewTask> & { status?: ReviewTaskStatus },
) {
  const tasks = await readReviewTasks();
  const index = tasks.findIndex((task) => task.id === id);

  if (index === -1) {
    return null;
  }

  const current = tasks[index];
  const nextTask: ReviewTask = {
    ...current,
    ...payload,
    updatedAt: new Date().toISOString(),
  };

  tasks[index] = nextTask;
  await writeReviewTasks(tasks);
  return nextTask;
}

export function getStorageBackend() {
  return useRedis() ? "upstash-redis" : "local-file";
}
