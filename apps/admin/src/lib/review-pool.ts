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

async function readReviewTasks(): Promise<ReviewTask[]> {
  await ensureReviewFile();
  const raw = await readFile(reviewFilePath, "utf-8");
  return JSON.parse(raw) as ReviewTask[];
}

async function writeReviewTasks(tasks: ReviewTask[]) {
  await ensureReviewFile();
  await writeFile(reviewFilePath, `${JSON.stringify(tasks, null, 2)}\n`, "utf-8");
}

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

export async function createReviewTaskFromRegularQuestion(
  request: RegularQuestionRequest,
  rejectReason: string,
) {
  const tasks = await readReviewTasks();
  const task = createBaseTask({
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
  tasks.unshift(task);
  await writeReviewTasks(tasks);
  return task;
}

export async function createReviewTaskFromExternalPurchase(
  request: ExternalPurchaseRequest,
  rejectReason: string,
) {
  const tasks = await readReviewTasks();
  const task = createBaseTask({
    type: "外购查询",
    requesterId: request.requesterId,
    requesterName: request.requesterName,
    category: "外购与非认可物料/器具",
    description: [request.name, request.description].filter(Boolean).join("｜"),
    rejectReason,
    sourcePayload: request,
  });
  tasks.unshift(task);
  await writeReviewTasks(tasks);
  return task;
}

export async function createReviewTaskFromOldItem(
  request: OldItemRequest,
  rejectReason: string,
) {
  const tasks = await readReviewTasks();
  const task = createBaseTask({
    type: "旧品比对",
    requesterId: request.requesterId,
    requesterName: request.requesterName,
    category: "旧品比对",
    description: [request.name, request.remark].filter(Boolean).join("｜"),
    rejectReason,
    sourcePayload: request,
  });
  tasks.unshift(task);
  await writeReviewTasks(tasks);
  return task;
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
