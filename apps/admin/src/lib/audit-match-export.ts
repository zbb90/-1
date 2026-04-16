import * as XLSX from "xlsx";
import type {
  AuditConsensusAnalysis,
  AuditConsensusMatchResult,
} from "@/lib/audit-match-types";

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function analysisRows(results: AuditConsensusMatchResult[]) {
  return results.map((result) => ({
    稽核编号: result.auditClause.auditId,
    条款层级: result.auditClause.level,
    稽核条文: result.auditClause.clauseTitle,
    推荐共识ID: result.bestMatch?.consensusId ?? "",
    推荐共识标题: result.bestMatch?.title ?? "",
    匹配状态:
      result.status === "matched"
        ? "高置信命中"
        : result.status === "review"
          ? "待人工复核"
          : "未匹配",
    置信度: formatPercent(result.confidence),
    匹配理由: result.reasons.join("；"),
    候选共识:
      result.candidates
        .map((candidate) => `${candidate.consensusId}｜${candidate.title}`)
        .join("；") || "",
    是否需人工复核: result.reviewRequired ? "是" : "否",
  }));
}

function draftRows(results: AuditConsensusMatchResult[]) {
  return results
    .filter((result) => result.bestMatch)
    .map((result) => ({
      稽核编号: result.auditClause.auditId,
      稽核条文: result.auditClause.clauseTitle,
      推荐共识ID: result.bestMatch?.consensusId ?? "",
      推荐共识标题: result.bestMatch?.title ?? "",
      共识类型: result.bestMatch?.type ?? "",
      置信度: formatPercent(result.confidence),
      处理建议: result.reviewRequired ? "人工确认后纳入知识草稿" : "可优先确认入库",
      理由: result.reasons.join("；"),
    }));
}

export function buildAuditMatchWorkbook(
  analysis: AuditConsensusAnalysis,
  selectedKeys?: string[],
) {
  const workbook = XLSX.utils.book_new();
  const selectedSet = new Set(selectedKeys ?? []);
  const selectedResults =
    selectedSet.size > 0
      ? analysis.results.filter((result) => selectedSet.has(result.auditKey))
      : analysis.results.filter((result) => result.status !== "unmatched");

  const summarySheet = XLSX.utils.json_to_sheet([
    {
      稽核条款数: analysis.summary.totalAuditClauses,
      共识数: analysis.summary.totalConsensus,
      高置信命中: analysis.summary.matched,
      待人工复核: analysis.summary.reviewRequired,
      未匹配: analysis.summary.unmatched,
      平均置信度: formatPercent(analysis.summary.averageConfidence),
    },
  ]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "分析摘要");

  const resultSheet = XLSX.utils.json_to_sheet(analysisRows(analysis.results));
  XLSX.utils.book_append_sheet(workbook, resultSheet, "匹配结果");

  const reviewSheet = XLSX.utils.json_to_sheet(
    analysisRows(analysis.results.filter((result) => result.reviewRequired)),
  );
  XLSX.utils.book_append_sheet(workbook, reviewSheet, "待复核");

  const draftSheet = XLSX.utils.json_to_sheet(draftRows(selectedResults));
  XLSX.utils.book_append_sheet(workbook, draftSheet, "知识沉淀草稿");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export function buildAuditMatchCsv(analysis: AuditConsensusAnalysis) {
  const worksheet = XLSX.utils.json_to_sheet(analysisRows(analysis.results));
  return XLSX.utils.sheet_to_csv(worksheet);
}
