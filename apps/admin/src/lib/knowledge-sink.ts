import { appendRow } from "@/lib/knowledge-store";
import { getReviewTaskById, updateReviewTask } from "@/lib/review-pool";
import { upsertFaqVectors, upsertRuleVectors } from "@/lib/vector-store";
import type { FaqRow, ReviewTask, ReviewTaskType, RuleRow } from "@/lib/types";
import type { KbTableName } from "@/lib/knowledge-csv";

type SinkAudit = {
  table: KbTableName;
  newId: string;
  vectorSync: "synced" | "skipped";
  vectorSyncReason?: string;
  verifyResult?: "matched" | "mismatch" | "pending";
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

function extractKeywords(text: string) {
  const stops =
    /^(的|了|在|是|有|没有|一个|这个|那个|可以|不|我|你|他|它|门店|伙伴|问题|请问)$/;
  return [
    ...new Set(
      text
        .replace(/[，。！？、；：""''（）\s]+/g, "|")
        .split("|")
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && !stops.test(s)),
    ),
  ]
    .slice(0, 6)
    .join("|");
}

function buildRuleRow(task: ReviewTask): Record<string, string> {
  const { clauseCode, reason } = splitClauseAndReason(task);
  const explanation = buildKnowledgeExplanation(task);
  const desc = normalizeText(task.description);
  const conclusion = normalizeText(task.finalConclusion);
  const finalExplanation = normalizeText(task.finalExplanation);

  const keywords = extractKeywords(desc);
  const sceneDesc = reason || conclusion || desc;
  const exampleQuestion =
    desc !== sceneDesc ? desc : `${task.category || ""}相关：${desc}`;
  const clauseSnippet = finalExplanation || reason || conclusion || desc;

  return {
    问题分类: task.category || "-",
    问题子类或关键词: keywords || desc,
    场景描述: sceneDesc,
    触发条件: reason || conclusion || "-",
    是否扣分: conclusion.includes("扣分")
      ? "是"
      : conclusion.includes("不扣")
        ? "否"
        : "按场景判定",
    扣分分值: task.finalScore || "0",
    条款编号: clauseCode,
    条款标题: conclusion || "-",
    条款关键片段: clauseSnippet,
    条款解释: explanation,
    共识来源: `复核任务 ${task.id}`,
    示例问法: exampleQuestion,
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

function buildFaqRow(task: ReviewTask): Record<string, string> {
  const { clauseCode } = splitClauseAndReason(task);
  const explanation = buildKnowledgeExplanation(task);
  const desc = normalizeText(task.description);
  const conclusion = normalizeText(task.finalConclusion);
  const finalExplanation = normalizeText(task.finalExplanation);

  // 答案优先用主管最终解释；若无则拼装"结论 + 默认提示"
  const answer = finalExplanation || conclusion || explanation;
  // 关联条款 / 共识：尽量从 finalClause 中识别 R-xxxx / C-xxxx 形式（多个用 | 拼接）
  const clauseMatches = (task.finalClause || "").match(/R-\d{4,}/gi) || [];
  const consensusMatches = (task.finalClause || "").match(/C-?S?\d{4,}/gi) || [];

  return {
    问题: desc || `${task.category || ""}相关问题`,
    答案: answer || "-",
    关联条款编号: [...new Set([...clauseMatches, clauseCode].filter(Boolean))]
      .filter((v) => v !== "-")
      .join("|"),
    关联共识编号: [...new Set(consensusMatches)].join("|"),
    review_id: task.id,
    沉积来源: "复核沉淀",
    命中关键词: extractKeywords(desc),
    tags: "faq|review-sink",
    状态: "启用",
    备注: `由主管 ${task.processor || "-"} 于 ${new Date().toLocaleDateString("zh-CN")} 沉淀`,
    更新时间: new Date().toISOString(),
  };
}

function resolveSinkTarget(
  task: ReviewTask,
  prefer: "default" | "faq" = "default",
): {
  table: KbTableName;
  row: Record<string, string>;
} {
  const type = task.type as ReviewTaskType;

  if (prefer === "faq" && type === "常规问题") {
    return { table: "faq", row: buildFaqRow(task) };
  }

  switch (type) {
    case "常规问题":
      return { table: "rules", row: buildRuleRow(task) };
    case "外购查询":
      return { table: "external-purchases", row: buildExternalPurchaseRow(task) };
    case "旧品比对":
      return { table: "old-items", row: buildOldItemRow(task) };
  }
}

export async function sinkReviewTaskToKnowledge(
  taskId: string,
  options: { prefer?: "default" | "faq" } = {},
): Promise<{
  task: ReviewTask;
  audit: SinkAudit;
}> {
  const task = await getReviewTaskById(taskId);
  if (!task) {
    throw new KnowledgeSinkError("未找到对应任务。", 404);
  }

  if (!task.finalConclusion?.trim() && !task.finalExplanation?.trim()) {
    throw new KnowledgeSinkError("任务尚未填写最终结论或解释，无法沉淀到知识库。", 422);
  }

  const prefer = options.prefer ?? "default";
  const target = resolveSinkTarget(task, prefer);
  const inserted = await appendRow(target.table, target.row);

  let vectorSync: SinkAudit["vectorSync"] = "skipped";
  let vectorSyncReason: string | undefined;
  if (target.table === "faq") {
    try {
      const syncResult = await upsertFaqVectors([inserted as unknown as FaqRow]);
      if (syncResult.ok) {
        vectorSync = "synced";
      } else {
        vectorSyncReason = syncResult.reason;
      }
    } catch (err) {
      vectorSyncReason = err instanceof Error ? err.message : "faq vector sync failed";
    }
  } else if (target.table === "rules") {
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const syncResult = await upsertRuleVectors([inserted as unknown as RuleRow]);
      if (syncResult.ok) {
        vectorSync = "synced";
        break;
      }
      vectorSyncReason = syncResult.reason;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    if (vectorSync === "skipped") {
      console.warn(
        `rule vector sync failed after ${MAX_RETRIES + 1} attempts, marking as 待向量同步`,
        vectorSyncReason,
      );
      try {
        const { patchRowStatus } = await import("@/lib/knowledge-csv");
        await patchRowStatus("rules", inserted.rule_id ?? "", "待向量同步");
      } catch (patchErr) {
        console.warn("failed to mark rule as 待向量同步", patchErr);
      }
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
        : target.table === "faq"
          ? inserted.faq_id
          : "-";

  let verifyResult: SinkAudit["verifyResult"] = undefined;
  if (target.table === "rules" && vectorSync === "synced" && task.description) {
    verifyMatchAfterSink({
      description: task.description,
      category: task.category,
      expectedRuleId: newId || "",
    }).catch(() => {});
  }

  return {
    task: updatedTask,
    audit: {
      table: target.table,
      newId: newId || "-",
      vectorSync,
      vectorSyncReason,
      verifyResult,
    },
  };
}

async function verifyMatchAfterSink(params: {
  description: string;
  category?: string;
  expectedRuleId: string;
}) {
  try {
    const { matchRegularQuestion } = await import("@/lib/knowledge-base");
    const result = await matchRegularQuestion({
      description: params.description,
      category: params.category,
    });

    if (result.matched && result.answer.ruleId === params.expectedRuleId) {
      console.info(
        `[sink-verify] OK: "${params.description}" → ${params.expectedRuleId}`,
      );
    } else {
      const actualId = result.matched ? result.answer.ruleId : "none";
      console.warn(
        `[sink-verify] MISMATCH: "${params.description}" expected ${params.expectedRuleId}, got ${actualId}`,
      );
    }
  } catch (err) {
    console.warn("[sink-verify] verification failed", err);
  }
}
