import { loadKnowledgeTable } from "@/lib/knowledge-loader";
import type {
  ConsensusRow,
  RegularQuestionCandidatePayload,
  RegularQuestionMatchResult,
  RegularQuestionRequest,
} from "@/lib/types";

function normalizeText(input?: string) {
  return (input ?? "").trim().toLowerCase();
}

function normalizeLooseText(input?: string) {
  return normalizeText(input).replace(
    /[\s,，。；;：:、|/\\()（）[\]【】'"“”‘’\-<>_=+*#@!！？%&~`^0-9a-z]+/gi,
    "",
  );
}

function buildQueryText(request: RegularQuestionRequest) {
  return [
    request.category,
    request.issueTitle,
    request.description,
    request.selfJudgment,
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildConsensusText(row: ConsensusRow) {
  return [
    row.标题,
    row.适用场景,
    row.解释内容,
    row.判定结果,
    row.扣分分值,
    row.关键词,
    row.示例问题,
    row.来源文件,
  ]
    .filter(Boolean)
    .join(" ");
}

function isPrivateItemQuestion(request: RegularQuestionRequest) {
  const text = normalizeLooseText(buildQueryText(request));
  return /私人物品|个人物品|私人用品|员工自用|自用|营运区域|操作区|吧台|后厨/.test(
    text,
  );
}

function scorePrivateItemConsensus(row: ConsensusRow, request: RegularQuestionRequest) {
  const queryLoose = normalizeLooseText(buildQueryText(request));
  const rowLoose = normalizeLooseText(buildConsensusText(row));
  let score = 0;
  const reasons: string[] = [];

  if (/私人物品|个人物品|私人用品/.test(queryLoose)) {
    if (/私人物品|个人物品|私人用品/.test(rowLoose)) {
      score += 48;
      reasons.push("问题与共识均指向私人物品");
    } else {
      score -= 20;
    }
  }

  if (/员工自用|自用/.test(queryLoose) && /员工自用|自用/.test(rowLoose)) {
    score += 24;
    reasons.push("命中员工自用口径");
  }

  if (
    /营运区域|操作区|吧台|后厨/.test(queryLoose) &&
    /营运区域|操作区|吧台|后厨/.test(rowLoose)
  ) {
    score += 18;
    reasons.push("命中营运区域/操作区场景");
  }

  if (/扣分|是否|可以|能不能|算不算/.test(queryLoose)) {
    score += 8;
  }

  return { score, reasons };
}

export async function matchScenarioPolicyQuestion(
  request: RegularQuestionRequest,
): Promise<RegularQuestionMatchResult | null> {
  if (!isPrivateItemQuestion(request)) return null;

  const consensusRows = await loadKnowledgeTable<ConsensusRow>("consensus");
  const scored = consensusRows
    .map((row) => ({ row, ...scorePrivateItemConsensus(row, request) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const top = scored[0];
  if (!top || top.score < 42) return null;

  const explanation = top.row.解释内容 || top.row.示例问题 || "";
  const clauseTitle = top.row.标题 || "私人物品/员工自用场景共识";
  const clauseNo = top.row.关联条款编号 || top.row.consensus_id;
  const candidatePayloads: RegularQuestionCandidatePayload[] = scored.map((c) => ({
    ruleId: c.row.consensus_id,
    category: c.row.适用场景 || "业务共识",
    clauseNo: c.row.关联条款编号 || c.row.consensus_id,
    clauseTitle: c.row.标题 || "业务共识",
    score: Math.round(c.score),
  }));

  return {
    matched: true,
    topScore: Math.round(top.score),
    answer: {
      ruleId: top.row.consensus_id,
      category: top.row.适用场景 || "业务共识",
      shouldDeduct: top.row.判定结果 || "按场景判定",
      deductScore: top.row.扣分分值 || "按共识判定",
      clauseNo,
      clauseTitle,
      clauseSnippet: explanation.slice(0, 120),
      explanation,
      source: `${clauseTitle} / ${top.row.来源文件 || "业务共识沉淀"}`,
      matchedReasons: top.reasons,
      consensusKeywords: top.row.关键词?.trim() || "",
      consensusApplicableScene: top.row.适用场景?.trim() || "",
      aiExplanation: explanation,
      sourceKind: "consensus",
      consensusId: top.row.consensus_id,
    },
    candidates: candidatePayloads,
    debug: {
      retrievalMode: "scenario-policy",
      semanticEnabled: false,
      queryText: buildQueryText(request),
      recalled: [],
      retrievalSources: ["consensus", "scenario-policy"],
      rerankedTop: candidatePayloads,
      judgeMode: "heuristic",
      judgeSelectedRuleId: top.row.consensus_id,
      judgeReason: top.reasons.join("；") || "命中私人物品/员工自用场景共识",
      judgeConfidence: Math.round(top.score),
    },
  };
}
