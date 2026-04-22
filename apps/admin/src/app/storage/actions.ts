"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { repairReviewTaskStorage, type ReviewRepairSource } from "@/lib/review-pool";
import { readRows, restoreKnowledgeBaseFromCsv } from "@/lib/knowledge-store";
import { repairUserIndexes } from "@/lib/user-store";
import {
  isSemanticSearchConfigured,
  rebuildKnowledgeVectorIndex,
} from "@/lib/vector-store";
import type { ConsensusRow, FaqRow, RuleRow } from "@/lib/types";

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
