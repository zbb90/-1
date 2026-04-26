"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { repairReviewTaskStorage, type ReviewRepairSource } from "@/lib/review-pool";
import {
  readRows,
  replaceTableRows,
  restoreKnowledgeBaseFromCsv,
} from "@/lib/knowledge-store";
import { repairUserIndexes } from "@/lib/user-store";
import {
  isSemanticSearchConfigured,
  rebuildKnowledgeVectorIndex,
} from "@/lib/vector-store";
import type {
  ConsensusRow,
  FaqRow,
  OperationRow,
  ProductionCheckRow,
  RuleRow,
} from "@/lib/types";

async function assertLeaderSession() {
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  if (session?.role !== "leader") {
    redirect("/reviews");
  }
  return session;
}

function redirectWithMessage(message: string) {
  redirect(`/storage?message=${encodeURIComponent(message)}`);
}

function revalidateStorageRelatedPages() {
  revalidatePath("/");
  revalidatePath("/reviews");
  revalidatePath("/conversations");
  revalidatePath("/users");
  revalidatePath("/storage");
}

export async function repairReviewStorageAction(formData: FormData) {
  await assertLeaderSession();
  const rawSource = String(
    formData.get("source") ?? "redis",
  ).trim() as ReviewRepairSource;
  const source: ReviewRepairSource =
    rawSource === "redis" || rawSource === "legacy" || rawSource === "file"
      ? rawSource
      : "auto";

  const result = await repairReviewTaskStorage(source);
  revalidateStorageRelatedPages();
  redirectWithMessage(
    `复核数据修复完成：来源 ${result.source}，任务 ${result.indexedTasks}/${result.totalTasks}，请求人分桶 ${result.requesterBuckets}。`,
  );
}

export async function restoreKnowledgeFromCsvAction() {
  await assertLeaderSession();
  const result = await restoreKnowledgeBaseFromCsv();
  revalidateStorageRelatedPages();
  const tableSummary = Object.entries(result.restoredTables)
    .map(([table, count]) => `${table}:${count}`)
    .join("，");
  const vectorSummary =
    result.vectorRebuild.status === "done"
      ? `规则向量重建 ${result.vectorRebuild.count} 条`
      : `规则向量未重建：${result.vectorRebuild.reason}`;
  redirectWithMessage(`知识库恢复完成：${tableSummary}；${vectorSummary}。`);
}

export async function repairUserIndexesAction() {
  await assertLeaderSession();
  const result = await repairUserIndexes();
  revalidateStorageRelatedPages();
  redirectWithMessage(
    `账号索引修复完成：用户 ${result.repairedUsers}，手机号索引 ${result.repairedPhoneIndexes}。`,
  );
}

export async function rebuildKnowledgeVectorIndexAction() {
  await assertLeaderSession();
  if (!isSemanticSearchConfigured()) {
    redirectWithMessage("向量检索未配置（DashScope 或 Qdrant 缺失），重建已跳过。");
    return;
  }
  const [rules, consensus, faq] = await Promise.all([
    readRows("rules") as Promise<unknown> as Promise<RuleRow[]>,
    readRows("consensus") as Promise<unknown> as Promise<ConsensusRow[]>,
    readRows("faq") as Promise<unknown> as Promise<FaqRow[]>,
  ]);
  const result = await rebuildKnowledgeVectorIndex(rules, consensus, faq);
  revalidateStorageRelatedPages();
  if (!result.ok) {
    redirectWithMessage(
      `知识向量重建未完成：${result.ruleReason || result.consensusReason || result.faqReason || "未知原因"}（规则 ${result.rules}，共识 ${result.consensus}，FAQ ${result.faq}）。`,
    );
  }
  redirectWithMessage(
    `知识向量重建完成：规则 ${result.rules} 条、共识 ${result.consensus} 条、FAQ ${result.faq} 条。`,
  );
}

function isBlankOperationRow(row: Record<string, string>) {
  return [
    "资料类型",
    "标题",
    "适用对象",
    "关键词",
    "操作内容",
    "检核要点",
    "解释说明",
    "来源文件",
  ].every((field) => !row[field]?.trim());
}

function isProductionChecklistOperation(row: OperationRow) {
  return /出品操作检查|出品操作检查扣分标准|产品检核表|自动从出品操作检查表导入/.test(
    [row.资料类型, row.标题, row.来源文件, row.备注].filter(Boolean).join("\n"),
  );
}

function parseOperationChecklistTitle(row: OperationRow) {
  const [product = row.适用对象 || "", checkKind = "", detail = row.操作内容 || ""] = (
    row.标题 || ""
  )
    .split("｜")
    .map((part) => part.trim());
  return { product, checkKind, detail };
}

function nextProductionCheckId(existing: ProductionCheckRow[], offset: number) {
  return `PC-${String(existing.length + offset + 1).padStart(4, "0")}`;
}

function migrateOperationToProductionCheck(
  row: OperationRow,
  existing: ProductionCheckRow[],
  offset: number,
): ProductionCheckRow {
  const parsed = parseOperationChecklistTitle(row);
  const product = row.适用对象?.trim() || parsed.product;
  const checkKind = parsed.checkKind || "稽核点";
  const checkPoint = row.操作内容?.trim() || parsed.detail || row.标题;

  return {
    check_id: nextProductionCheckId(existing, offset),
    来源文件: row.来源文件 || "",
    区域: /检查区域：([^\n]+)/.exec(row.检核要点 || "")?.[1]?.trim() || "",
    产品名称: product,
    产品别名: "",
    风险分类: /扣分分类：([^\n]+)/.exec(row.检核要点 || "")?.[1]?.trim() || "",
    检核类型: checkKind,
    检查点: checkPoint,
    违规表达: checkPoint,
    解释说明: row.解释说明 || "",
    判定口径: "出品检查扣分标准",
    关联操作编号: "",
    关联条款编号: "",
    关联共识编号: "",
    状态: row.状态 || "启用",
    备注: [row.备注, row.op_id ? `由操作知识 ${row.op_id} 迁出` : ""]
      .filter(Boolean)
      .join("；"),
    tags: row.关键词 || row.tags || "",
  };
}

export async function migrateProductionChecksFromOperationsAction() {
  await assertLeaderSession();
  const [operationRows, productionCheckRows] = await Promise.all([
    readRows("operations") as Promise<unknown> as Promise<OperationRow[]>,
    readRows("production-checks") as Promise<unknown> as Promise<ProductionCheckRow[]>,
  ]);

  const existingSignatures = new Set(
    productionCheckRows.map((row) =>
      [row.产品名称, row.检核类型, row.检查点].join("::").trim(),
    ),
  );
  const keptOperations: OperationRow[] = [];
  const migrated: ProductionCheckRow[] = [];
  let removedFromOperations = 0;

  for (const row of operationRows) {
    if (!isProductionChecklistOperation(row)) {
      keptOperations.push(row);
      continue;
    }
    removedFromOperations++;
    const converted = migrateOperationToProductionCheck(
      row,
      productionCheckRows,
      migrated.length,
    );
    const signature = [converted.产品名称, converted.检核类型, converted.检查点]
      .join("::")
      .trim();
    if (!signature || existingSignatures.has(signature)) {
      continue;
    }
    existingSignatures.add(signature);
    migrated.push(converted);
  }

  if (removedFromOperations > 0) {
    const writes: Array<Promise<void>> = [
      replaceTableRows(
        "operations",
        keptOperations as unknown as Record<string, string>[],
      ),
    ];
    if (migrated.length > 0) {
      writes.push(
        replaceTableRows("production-checks", [
          ...productionCheckRows,
          ...migrated,
        ] as unknown as Record<string, string>[]),
      );
    }
    await Promise.all(writes);
  }

  revalidateStorageRelatedPages();
  redirectWithMessage(
    removedFromOperations > 0
      ? `出品检查标准迁移完成：从操作知识移出 ${removedFromOperations} 条，新增到出品检查标准 ${migrated.length} 条，操作知识保留 ${keptOperations.length} 条。`
      : "未发现需要从操作知识迁出的出品检查标准，或新表已存在对应条目。",
  );
}

export async function cleanBlankOperationRowsAction() {
  await assertLeaderSession();
  const rows = (await readRows("operations")) as Record<string, string>[];
  const kept = rows.filter((row) => !isBlankOperationRow(row));
  const removed = rows.length - kept.length;

  if (removed > 0) {
    await replaceTableRows("operations", kept);
  }

  revalidateStorageRelatedPages();
  redirectWithMessage(
    removed > 0
      ? `操作知识空白行清理完成：删除 ${removed} 条，保留 ${kept.length} 条。`
      : "操作知识没有发现空白行，无需清理。",
  );
}
