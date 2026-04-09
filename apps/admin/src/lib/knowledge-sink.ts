import { appendRow } from "@/lib/knowledge-store";
import { getReviewTaskById, updateReviewTask } from "@/lib/review-pool";
import { upsertRuleVectors } from "@/lib/vector-store";
import type { ReviewTask, ReviewTaskType, RuleRow } from "@/lib/types";
import type { KbTableName } from "@/lib/knowledge-csv";

type SinkAudit = {
  table: KbTableName;
  newId: string;
  vectorSync: "synced" | "skipped";
  vectorSyncReason?: string;
};

export class KnowledgeSinkError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "KnowledgeSinkError";
    this.status = status;
  }
}

function normalizeText(value?: string) {
  return value?.trim() || "";
}

function looksLikeClauseCode(value?: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  return /^(?:[A-Z]\d+(?:\.\d+)*|\d+(?:\.\d+)*|R-\d{4,})$/i.test(normalized);
}

function splitClauseAndReason(task: ReviewTask) {
  const raw = normalizeText(task.finalClause);
  if (!raw) {
    return { clauseCode: "-", reason: "" };
  }

  if (looksLikeClauseCode(raw)) {
    return { clauseCode: raw, reason: "" };
  }

  return { clauseCode: "-", reason: raw };
}

function buildKnowledgeExplanation(task: ReviewTask) {
  const { reason } = splitClauseAndReason(task);
  const explanation = normalizeText(task.finalExplanation);

  if (reason && explanation) {
    return `主管判定依据：${reason}\n${explanation}`;
  }
  if (explanation) {
    return explanation;
  }
  if (reason) {
    return `主管判定依据：${reason}`;
  }

  return "-";
}

function buildRuleRow(task: ReviewTask): Record<string, string> {
  const { clauseCode, reason } = splitClauseAndReason(task);
  const explanation = buildKnowledgeExplanation(task);

  return {
    问题分类: task.category || "-",
    问题子类或关键词: task.description || "-",
    场景描述: task.description || "-",
    触发条件: reason || "-",
    是否扣分: task.finalConclusion?.includes("扣分") ? "是" : "否",
    扣分分值: task.finalScore || "0",
    条款编号: clauseCode,
    条款标题: task.finalConclusion || "-",
    条款关键片段: reason || task.description || "-",
    条款解释: explanation,
    共识来源: `复核任务 ${task.id}`,
    示例问法: task.description || "-",
    状态: "启用",
    备注: `由主管 ${task.processor || "-"} 于 ${new Date().toLocaleDateString("zh-CN")} 沉淀`,
  };
}

function buildExternalPurchaseRow(task: ReviewTask): Record<string, string> {
  const { reason } = splitClauseAndReason(task);
  const explanation = buildKnowledgeExplanation(task);

  return {
    物品名称: task.description || "-",
    别名或关键词: task.description || "-",
    是否允许外购: task.finalConclusion || "-",
    命中的清单或共识名称: reason || task.finalConclusion || "-",
    依据来源: `复核任务 ${task.id}`,
    说明: explanation,
    状态: "启用",
    备注: `由主管 ${task.processor || "-"} 沉淀`,
  };
}

function buildOldItemRow(task: ReviewTask): Record<string, string> {
  const explanation = buildKnowledgeExplanation(task);

  return {
    物品名称: task.description || "-",
    别名或常见叫法: task.description || "-",
    是否旧品: task.finalConclusion?.includes("旧品") ? "是" : "否",
    命中的清单名称: `复核任务 ${task.id}`,
    识别备注: explanation,
    参考图片名称: "-",
    状态: "启用",
    备注: `由主管 ${task.processor || "-"} 沉淀`,
  };
}

function resolveSinkTarget(task: ReviewTask): {
  table: KbTableName;
  row: Record<string, string>;
} {
  const type = task.type as ReviewTaskType;

  switch (type) {
    case "常规问题":
      return { table: "rules", row: buildRuleRow(task) };
    case "外购查询":
      return { table: "external-purchases", row: buildExternalPurchaseRow(task) };
    case "旧品比对":
      return { table: "old-items", row: buildOldItemRow(task) };
  }
}

export async function sinkReviewTaskToKnowledge(taskId: string): Promise<{
  task: ReviewTask;
  audit: SinkAudit;
}> {
  const task = await getReviewTaskById(taskId);
  if (!task) {
    throw new KnowledgeSinkError("未找到对应任务。", 404);
  }

  if (!task.finalConclusion?.trim()) {
    throw new KnowledgeSinkError("任务尚未填写最终结论，无法沉淀到知识库。", 422);
  }

  const target = resolveSinkTarget(task);
  const inserted = await appendRow(target.table, target.row);

  let vectorSync: SinkAudit["vectorSync"] = "skipped";
  let vectorSyncReason: string | undefined;
  if (target.table === "rules") {
    const syncResult = await upsertRuleVectors([inserted as unknown as RuleRow]);
    if (syncResult.ok) {
      vectorSync = "synced";
    } else {
      vectorSyncReason = syncResult.reason;
      console.warn("rule vector sync skipped after sink", syncResult.reason);
    }
  }

  const updatedTask = await updateReviewTask(task.id, { status: "已加入知识库" });
  if (!updatedTask) {
    throw new KnowledgeSinkError("知识已写入，但回写复核任务状态失败。", 500);
  }

  const newId =
    target.table === "rules"
      ? inserted.rule_id
      : target.table === "external-purchases" || target.table === "old-items"
        ? inserted.item_id
        : "-";

  return {
    task: updatedTask,
    audit: {
      table: target.table,
      newId: newId || "-",
      vectorSync,
      vectorSyncReason,
    },
  };
}
