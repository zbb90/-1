import {
  getDashScopeApiKey,
  parseJsonObject,
  requestDashScopeChat,
} from "@/lib/dashscope-client";
import { embedTexts } from "@/lib/embeddings";
import type {
  AuditClause,
  AuditConsensusAnalysis,
  AuditConsensusMatchResult,
  AuditConsensusMatchSummary,
  ConsensusEntry,
  MatchCandidate,
} from "@/lib/audit-match-types";

const STOPWORDS = new Set([
  "门店",
  "现场",
  "要求",
  "相关",
  "情况",
  "进行",
  "出现",
  "使用",
  "按照",
  "需",
  "可",
  "与",
  "及",
  "或",
  "的",
  "了",
  "在",
  "未",
  "并",
  "且",
]);

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildReasons(reasons: Array<string | null | undefined>) {
  return reasons.filter(Boolean) as string[];
}

function extractTokens(text: string) {
  const source = normalizeText(text).toLowerCase();
  const tokens = new Set<string>();
  const latinTokens = source.match(/[a-z0-9._-]+/g) ?? [];
  for (const token of latinTokens) {
    if (token.length >= 2 && !STOPWORDS.has(token)) tokens.add(token);
  }

  const chineseChunks = source.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const chunk of chineseChunks) {
    if (chunk.length <= 8 && !STOPWORDS.has(chunk)) {
      tokens.add(chunk);
    }
    for (let size = 2; size <= Math.min(4, chunk.length); size += 1) {
      for (let index = 0; index <= chunk.length - size; index += 1) {
        const token = chunk.slice(index, index + size);
        if (!STOPWORDS.has(token)) tokens.add(token);
      }
    }
  }

  return [...tokens];
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function normalizeSimilarity(value: number) {
  return Math.max(0, Math.min(1, (value + 1) / 2));
}

function keywordScore(audit: AuditClause, consensus: ConsensusEntry) {
  const auditTokens = extractTokens(audit.searchText);
  const consensusTokens = new Set(extractTokens(consensus.searchText));
  if (auditTokens.length === 0 || consensusTokens.size === 0) {
    return { score: 0, overlaps: [] as string[] };
  }

  const overlaps = auditTokens.filter((token) => consensusTokens.has(token));
  let score = overlaps.length / Math.max(4, Math.min(auditTokens.length, 14));
  if (consensus.searchText.includes(audit.auditId)) score += 0.16;
  if (audit.score !== null && /(高危|重大|严重)/.test(consensus.contentText))
    score += 0.06;
  if (audit.level.includes("观察点") && consensus.title.includes("观察")) score += 0.04;
  return {
    score: Math.max(0, Math.min(1, score)),
    overlaps: overlaps.slice(0, 8),
  };
}

function heuristicDecision(
  auditClause: AuditClause,
  candidates: MatchCandidate[],
): AuditConsensusMatchResult {
  const bestMatch = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  const gap = bestMatch ? bestMatch.finalScore - (second?.finalScore ?? 0) : 0;
  let status: AuditConsensusMatchResult["status"] = "unmatched";
  let confidence = bestMatch?.finalScore ?? 0;
  let reviewRequired = true;
  let reasons: string[] = ["未找到足够强的共识候选。"];

  if (bestMatch) {
    reasons = buildReasons([
      bestMatch.reasons[0],
      bestMatch.semanticScore !== null
        ? `语义相似度 ${bestMatch.semanticScore.toFixed(2)}`
        : `关键词得分 ${bestMatch.keywordScore.toFixed(2)}`,
      gap > 0 ? `领先第 2 名 ${gap.toFixed(2)}` : null,
    ]);
  }

  if (bestMatch && bestMatch.finalScore >= 0.74 && gap >= 0.08) {
    status = "matched";
    confidence = Math.min(0.97, Math.max(bestMatch.finalScore, 0.82));
    reviewRequired = false;
    reasons = buildReasons(["头部候选明显领先，可作为高置信匹配。", ...reasons]);
  } else if (bestMatch && bestMatch.finalScore >= 0.54) {
    status = "review";
    confidence = Math.min(0.88, Math.max(bestMatch.finalScore, 0.58));
    reviewRequired = true;
    reasons = buildReasons(["已有候选，但仍建议人工确认。", ...reasons]);
  }

  return {
    auditKey: auditClause.key,
    auditClause,
    bestMatch,
    candidates,
    confidence,
    reasons,
    reviewRequired,
    status,
  };
}

async function rerankCandidatesWithEmbeddings(
  audit: AuditClause,
  recalled: Array<{ entry: ConsensusEntry; keyword: number; overlaps: string[] }>,
) {
  const texts = [audit.searchText, ...recalled.map((item) => item.entry.searchText)];
  const embeddings = await embedTexts(texts);
  if (!embeddings || embeddings.length !== texts.length) {
    return recalled.map((item) => ({
      entry: item.entry,
      keyword: item.keyword,
      overlaps: item.overlaps,
      semantic: null as number | null,
      finalScore: item.keyword,
    }));
  }

  const [auditVector, ...candidateVectors] = embeddings;
  return recalled.map((item, index) => {
    const semantic = normalizeSimilarity(
      cosineSimilarity(auditVector, candidateVectors[index]),
    );
    const finalScore = Math.min(1, item.keyword * 0.42 + semantic * 0.58);
    return {
      entry: item.entry,
      keyword: item.keyword,
      overlaps: item.overlaps,
      semantic,
      finalScore,
    };
  });
}

type LlmDecision = {
  selectedConsensusId?: string;
  confidence?: number;
  reviewRequired?: boolean;
  reasons?: string[];
  status?: "matched" | "review" | "unmatched";
};

async function judgeWithLlm(auditClause: AuditClause, candidates: MatchCandidate[]) {
  if (!getDashScopeApiKey() || candidates.length === 0) {
    return null;
  }

  const candidateBlock = candidates
    .slice(0, 3)
    .map(
      (candidate, index) => `候选${index + 1}
- consensusId: ${candidate.consensusId}
- 标题: ${candidate.title}
- type: ${candidate.type || "未提供"}
- clauseId: ${candidate.clauseId || "未提供"}
- 内容: ${candidate.contentText || "未提供"}
- 当前综合分: ${candidate.finalScore.toFixed(3)}
- 规则证据: ${candidate.reasons.join("；") || "无"}`,
    )
    .join("\n\n");

  const prompt = `
请判断哪条共识最适合匹配当前稽核条款。若都不合适，可返回 unmatched。

当前稽核条款：
- auditId: ${auditClause.auditId}
- 维度: ${auditClause.dimension || "未提供"}
- 层级: ${auditClause.level || "未提供"}
- 分值: ${auditClause.score ?? "未提供"}
- 条文: ${auditClause.clauseTitle}

候选共识：
${candidateBlock}

请输出 JSON：
{
  "selectedConsensusId": "字符串，可为空",
  "status": "matched | review | unmatched",
  "confidence": 0-1,
  "reviewRequired": true,
  "reasons": ["中文理由1", "中文理由2"]
}
`;

  const raw = await requestDashScopeChat(
    "你是稽核知识匹配裁判。只能在给定候选中选择，禁止编造新的 consensusId。输出严格 JSON。",
    prompt,
    {
      responseFormat: "json_object",
      maxTokens: 260,
      timeoutMs: 10000,
    },
  );
  return parseJsonObject<LlmDecision>(raw);
}

async function matchOneAuditClause(
  auditClause: AuditClause,
  consensusEntries: ConsensusEntry[],
): Promise<AuditConsensusMatchResult> {
  const recalled = consensusEntries
    .map((entry) => {
      const { score, overlaps } = keywordScore(auditClause, entry);
      return { entry, keyword: score, overlaps };
    })
    .filter((item) => item.keyword > 0)
    .sort((left, right) => right.keyword - left.keyword)
    .slice(0, 8);

  if (recalled.length === 0) {
    return heuristicDecision(auditClause, []);
  }

  const reranked = await rerankCandidatesWithEmbeddings(auditClause, recalled);
  const candidates = reranked
    .sort((left, right) => right.finalScore - left.finalScore)
    .slice(0, 5)
    .map(
      (item) =>
        ({
          consensusId: item.entry.consensusId,
          title: item.entry.title,
          type: item.entry.type,
          clauseId: item.entry.clauseId,
          contentText: item.entry.contentText,
          keywordScore: item.keyword,
          semanticScore: item.semantic,
          finalScore: item.finalScore,
          reasons: buildReasons([
            item.overlaps.length > 0 ? `命中关键词：${item.overlaps.join("、")}` : null,
            item.entry.type ? `共识类型：${item.entry.type}` : null,
            item.entry.clauseId ? `关联条款 ID：${item.entry.clauseId}` : null,
          ]),
        }) satisfies MatchCandidate,
    );

  const heuristic = heuristicDecision(auditClause, candidates);
  const bestNeedsLlm =
    heuristic.status !== "matched" ||
    (candidates[0] && candidates[1]
      ? candidates[0].finalScore - candidates[1].finalScore < 0.06
      : false);

  if (!bestNeedsLlm) {
    return heuristic;
  }

  const llm = await judgeWithLlm(auditClause, candidates);
  if (!llm) {
    return heuristic;
  }

  const bestMatch =
    candidates.find((candidate) => candidate.consensusId === llm.selectedConsensusId) ??
    heuristic.bestMatch;
  return {
    ...heuristic,
    bestMatch: llm.status === "unmatched" ? null : bestMatch,
    confidence:
      typeof llm.confidence === "number"
        ? Math.max(0, Math.min(1, llm.confidence))
        : heuristic.confidence,
    reasons: llm.reasons?.length ? llm.reasons : heuristic.reasons,
    reviewRequired:
      typeof llm.reviewRequired === "boolean"
        ? llm.reviewRequired
        : heuristic.reviewRequired,
    status: llm.status ?? heuristic.status,
  };
}

function summarizeResults(
  results: AuditConsensusMatchResult[],
  consensusEntries: ConsensusEntry[],
): AuditConsensusMatchSummary {
  const matched = results.filter((item) => item.status === "matched").length;
  const reviewRequired = results.filter((item) => item.status === "review").length;
  const unmatched = results.filter((item) => item.status === "unmatched").length;
  const highConfidence = results.filter((item) => item.confidence >= 0.8).length;
  const averageConfidence =
    results.length > 0
      ? Number(
          (
            results.reduce((sum, item) => sum + item.confidence, 0) / results.length
          ).toFixed(3),
        )
      : 0;

  return {
    totalAuditClauses: results.length,
    totalConsensus: consensusEntries.length,
    matched,
    reviewRequired,
    unmatched,
    highConfidence,
    averageConfidence,
  };
}

export async function analyzeAuditConsensus(
  auditClauses: AuditClause[],
  consensusEntries: ConsensusEntry[],
): Promise<AuditConsensusAnalysis> {
  const results: AuditConsensusMatchResult[] = [];
  for (const auditClause of auditClauses) {
    results.push(await matchOneAuditClause(auditClause, consensusEntries));
  }

  return {
    auditSheets: [],
    consensusSheets: [],
    auditClauses,
    consensusEntries,
    results,
    summary: summarizeResults(results, consensusEntries),
    warnings: [],
  };
}
