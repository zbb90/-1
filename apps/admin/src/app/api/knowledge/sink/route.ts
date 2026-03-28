import { NextRequest, NextResponse } from "next/server";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { getReviewTaskById, updateReviewTask } from "@/lib/review-pool";
import { loadKnowledgeBase } from "@/lib/knowledge-base";
import { appendCsvRow, readCsvHeaders } from "@/lib/csv-writer";
import { upsertRuleVectors } from "@/lib/vector-store";
import type { ReviewTask, ReviewTaskType, RuleRow } from "@/lib/types";

function resolveTemplateDir() {
  const candidates = [
    resolve(process.cwd(), "../../data/templates"),
    resolve(process.cwd(), "../../../data/templates"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function buildNewId(prefix: string, existingCount: number): string {
  const seq = String(existingCount + 1).padStart(4, "0");
  return `${prefix}-${seq}`;
}

async function sinkToRules(templateDir: string, task: ReviewTask) {
  const csvPath = resolve(templateDir, "03_常规问题规则表.csv");
  const headers = await readCsvHeaders(csvPath);

  const kb = await loadKnowledgeBase(false);
  const newId = buildNewId("R", kb.rules.length);

  const row: Record<string, string> = {
    rule_id: newId,
    问题分类: task.category || "-",
    问题子类或关键词: task.description || "-",
    场景描述: task.description || "-",
    触发条件: "-",
    是否扣分: task.finalConclusion?.includes("扣分") ? "是" : "否",
    扣分分值: task.finalScore || "0",
    条款编号: task.finalClause || "-",
    条款标题: task.finalConclusion || "-",
    条款关键片段: task.finalExplanation || "-",
    条款解释: task.finalExplanation || "-",
    共识来源: `复核任务 ${task.id}`,
    示例问法: task.description || "-",
    状态: "启用",
    备注: `由主管 ${task.processor || "-"} 于 ${new Date().toLocaleDateString("zh-CN")} 沉淀`,
  };

  const filteredRow: Record<string, string> = {};
  for (const h of headers) {
    filteredRow[h] = row[h] ?? "";
  }

  await appendCsvRow(csvPath, headers, filteredRow);
  return {
    newId,
    row: filteredRow as unknown as RuleRow,
  };
}

async function sinkToConsensus(templateDir: string, task: ReviewTask) {
  const csvPath = resolve(templateDir, "02_共识解释表.csv");
  const headers = await readCsvHeaders(csvPath);

  const kb = await loadKnowledgeBase(false);
  const newId = buildNewId("C", kb.consensus.length);
  const today = new Date().toLocaleDateString("zh-CN");

  const row: Record<string, string> = {
    consensus_id: newId,
    标题: task.finalConclusion || task.description || "-",
    关联条款编号: task.finalClause || "-",
    适用场景: task.description || "-",
    解释内容: task.finalExplanation || "-",
    判定结果: task.finalConclusion || "-",
    扣分分值: task.finalScore || "0",
    关键词: task.description || "-",
    示例问题: task.description || "-",
    来源文件: `复核任务 ${task.id}`,
    更新时间: today,
    状态: "启用",
    备注: `由主管 ${task.processor || "-"} 于 ${today} 沉淀`,
  };

  const filteredRow: Record<string, string> = {};
  for (const h of headers) {
    filteredRow[h] = row[h] ?? "";
  }

  await appendCsvRow(csvPath, headers, filteredRow);
  return newId;
}

async function sinkToExternalPurchases(templateDir: string, task: ReviewTask) {
  const csvPath = resolve(templateDir, "05_外购清单表.csv");
  const headers = await readCsvHeaders(csvPath);

  const kb = await loadKnowledgeBase(false);
  const newId = buildNewId("EP", kb.externalPurchases.length);

  const row: Record<string, string> = {
    item_id: newId,
    物品名称: task.description || "-",
    别名或关键词: task.description || "-",
    是否允许外购: task.finalConclusion || "-",
    命中的清单或共识名称: task.finalClause || "-",
    依据来源: `复核任务 ${task.id}`,
    说明: task.finalExplanation || "-",
    状态: "启用",
    备注: `由主管 ${task.processor || "-"} 沉淀`,
  };

  const filteredRow: Record<string, string> = {};
  for (const h of headers) {
    filteredRow[h] = row[h] ?? "";
  }

  await appendCsvRow(csvPath, headers, filteredRow);
  return newId;
}

async function sinkToOldItems(templateDir: string, task: ReviewTask) {
  const csvPath = resolve(templateDir, "04_旧品清单表.csv");
  const headers = await readCsvHeaders(csvPath);

  const kb = await loadKnowledgeBase(false);
  const newId = buildNewId("OI", kb.oldItems.length);

  const row: Record<string, string> = {
    item_id: newId,
    物品名称: task.description || "-",
    别名或常见叫法: task.description || "-",
    是否旧品: task.finalConclusion?.includes("旧品") ? "是" : "否",
    命中的清单名称: `复核任务 ${task.id}`,
    识别备注: task.finalExplanation || "-",
    参考图片名称: "-",
    状态: "启用",
    备注: `由主管 ${task.processor || "-"} 沉淀`,
  };

  const filteredRow: Record<string, string> = {};
  for (const h of headers) {
    filteredRow[h] = row[h] ?? "";
  }

  await appendCsvRow(csvPath, headers, filteredRow);
  return newId;
}

function sinkDispatcher(
  type: ReviewTaskType,
  templateDir: string,
  task: ReviewTask,
) {
  switch (type) {
    case "常规问题":
      return sinkToRules(templateDir, task).then((result) => result.newId);
    case "外购查询":
      return sinkToExternalPurchases(templateDir, task);
    case "旧品比对":
      return sinkToOldItems(templateDir, task);
  }
}

/**
 * POST /api/knowledge/sink
 * 主管确认后，将复核任务的最终结论追加到对应的 CSV 知识库，并刷新内存缓存。
 * 仅 Vercel 本地环境下 CSV 可写；生产 Serverless 无本地文件系统，此操作会记录日志但不写入。
 */
export async function POST(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份验证。" },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as { taskId: string };
    if (!body.taskId?.trim()) {
      return NextResponse.json(
        { ok: false, message: "缺少 taskId。" },
        { status: 400 },
      );
    }

    const task = await getReviewTaskById(body.taskId);
    if (!task) {
      return NextResponse.json(
        { ok: false, message: "未找到对应任务。" },
        { status: 404 },
      );
    }

    if (!task.finalConclusion?.trim()) {
      return NextResponse.json(
        { ok: false, message: "任务尚未填写最终结论，无法沉淀到知识库。" },
        { status: 422 },
      );
    }

    await updateReviewTask(task.id, { status: "已加入知识库" });

    const templateDir = resolveTemplateDir();
    if (!templateDir) {
      return NextResponse.json({
        ok: true,
        message:
          "任务已标记为「已加入知识库」，但当前部署环境无法写入本地 CSV（Vercel Serverless）。如需持久化规则，请在本地更新 CSV 并重新部署。",
        newId: null,
      });
    }

    let newId: string;
    let newRuleRow: RuleRow | null = null;

    if (task.type === "常规问题") {
      const sinkResult = await sinkToRules(templateDir, task);
      newId = sinkResult.newId;
      newRuleRow = sinkResult.row;
    } else {
      newId = await sinkDispatcher(task.type, templateDir, task);
    }
    await loadKnowledgeBase(true);

    if (newRuleRow) {
      const syncResult = await upsertRuleVectors([newRuleRow]);
      if (!syncResult.ok) {
        console.warn("rule vector sync skipped after sink", syncResult.reason);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `已成功追加到知识库，新条目 ID：${newId}`,
      newId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "知识沉淀操作失败",
      },
      { status: 500 },
    );
  }
}
