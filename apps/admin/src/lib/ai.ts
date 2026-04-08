import {
  getDashScopeApiKey,
  parseJsonObject,
  requestDashScopeChat,
} from "@/lib/dashscope-client";
import type {
  ExternalPurchaseRequest,
  OldItemRequest,
  RegularQuestionCandidatePayload,
  RegularQuestionIntentParse,
  RegularQuestionJudgeDecision,
  RegularQuestionRequest,
} from "@/lib/types";

type RegularQuestionAnswer = {
  shouldDeduct: string;
  deductScore: string;
  clauseNo: string;
  clauseTitle: string;
  clauseSnippet: string;
  explanation: string;
  source: string;
  matchedReasons?: string[];
  consensusKeywords?: string;
  consensusApplicableScene?: string;
};

export type RegularQuestionJudgeCandidate = RegularQuestionCandidatePayload & {
  shouldDeduct: string;
  deductScore: string;
  clauseSnippet: string;
  explanation: string;
  matchedReasons?: string[];
};

type ExternalPurchaseAnswer = {
  name: string;
  canPurchase: string;
  sourceName: string;
  sourceFile: string;
  explanation: string;
};

type OldItemAnswer = {
  name: string;
  isOldItem: string;
  sourceName: string;
  remark: string;
  imageRef: string;
};

function normalizeText(value?: string) {
  return value?.trim() || "未提供";
}

async function requestDashScope(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; responseFormat?: "text" | "json_object" },
) {
  return requestDashScopeChat(systemPrompt, userPrompt, options);
}

async function requestDashScopeExplanation(prompt: string) {
  return requestDashScope(
    "你是茶饮稽核助手。你只能根据用户提供的「规则命中结果」中的条款标题、条款片段、原始解释、判定结论、扣分分值、共识关键词与适用场景来组织语言，禁止编造共识文件中未出现的流程、场景、例外或结论。若用户描述与条款文字不完全一致，仍以条款与判定结论为准。输出中文，简洁、适合一线阅读。",
    prompt,
    { maxTokens: 260, responseFormat: "text" },
  );
}

function formatMatchedReasons(reasons?: string[]) {
  if (!reasons?.length) {
    return "无";
  }
  return reasons.join("；");
}

function buildDeterministicRegularQuestionExplanation(answer: RegularQuestionAnswer) {
  const conclusion = normalizeText(answer.shouldDeduct);
  const score = normalizeText(answer.deductScore);
  return `本条命中「${normalizeText(answer.clauseTitle)}」。共识要点见条款解释：${normalizeText(answer.explanation)}。系统判定结论为「${conclusion}」，对应扣分分值为「${score}」。请严格按稽核共识与现场情况执行；如需个案判断请走人工复核。`;
}

function buildDeterministicOperationExplanation(answer: RegularQuestionAnswer) {
  const focus = normalizeText(answer.explanation)
    .replace(/^重点看/, "")
    .replace(/[。；，、\s]+$/g, "");
  return `本次命中操作资料「${normalizeText(answer.clauseTitle)}」。执行时重点看${focus}。如现场版本与资料不一致，请以最新营运资料为准并同步更新知识库。`;
}

function buildHeuristicJudgeDecision(
  request: RegularQuestionRequest,
  intent: RegularQuestionIntentParse,
  candidates: RegularQuestionJudgeCandidate[],
): RegularQuestionJudgeDecision {
  const requestText = [
    normalizeText(request.issueTitle),
    normalizeText(request.description),
    normalizeText(request.selfJudgment),
  ].join(" ");
  const mentionsMachineFailure = /效期机|打印机|报修|机器坏|设备坏/.test(requestText);
  const ranked = candidates
    .map((candidate) => {
      let bonus = 0;
      const reasons: string[] = [];
      const blob = [
        candidate.clauseTitle,
        candidate.clauseSnippet,
        candidate.explanation,
        ...(candidate.matchedReasons ?? []),
      ].join(" ");

      const isPrivateRule = /私人物品|个人食用|私人区域/.test(blob);
      const isGenericExpiryRule = /物料无效期|效期缺失|无效期/.test(blob);
      const isDamageRule = /破损|漏液|胀包/.test(blob);
      const isStorageDiscardRule = /下架物料|禁用标识|仓库内/.test(blob);
      const isMachineFailureRule = /效期机|打印机|报修/.test(blob);
      const isStorageScene = intent.sceneTags.includes("仓储区");
      const isWasteScene = intent.sceneTags.includes("垃圾桶");
      const isPrivateScene = intent.sceneTags.includes("私人物品区");
      const hasExpiryIssue =
        intent.issueTags.includes("无效期") || intent.issueTags.includes("过期");

      if (isStorageScene && hasExpiryIssue && isGenericExpiryRule) {
        bonus += 18;
        reasons.push("仓储区 + 效期问题更贴近通用物料无效期规则");
      }

      if (isWasteScene && hasExpiryIssue && isGenericExpiryRule) {
        bonus += 14;
        reasons.push("垃圾桶/废弃回溯场景更贴近通用物料无效期规则");
      }

      if (
        (intent.exclusionTags.includes("非私人物品") ||
          intent.exclusionTags.includes("非个人食用")) &&
        isPrivateRule
      ) {
        bonus -= 26;
        reasons.push("已明确排除私人物品/个人食用");
      }

      if (!isPrivateScene && isPrivateRule) {
        bonus -= 12;
        reasons.push("当前未出现私人物品区场景");
      }

      if (hasExpiryIssue && isDamageRule && !intent.issueTags.includes("破损")) {
        bonus -= 24;
        reasons.push("当前主问题是效期，不应让纯破损规则抢占优先级");
      }

      if (isWasteScene && isStorageDiscardRule && !isStorageScene) {
        bonus -= 18;
        reasons.push("当前不是仓库下架物料场景");
      }

      if (hasExpiryIssue && isMachineFailureRule && !mentionsMachineFailure) {
        bonus -= 22;
        reasons.push("原始提问未提到效期机故障或报修");
      }

      if (intent.needsHumanVerification && candidate.shouldDeduct === "按场景判定") {
        bonus += 8;
        reasons.push("问题需核实，优先保留按场景判定类规则");
      }

      return {
        candidate,
        finalScore: candidate.score + bonus,
        reasons,
      };
    })
    .sort((left, right) => right.finalScore - left.finalScore);

  const best = ranked[0];
  return {
    judgeMode: "heuristic",
    selectedRuleId: best.candidate.ruleId,
    confidence: ranked.length > 1 ? 0.72 : 0.64,
    judgeReason: best.reasons.join("；") || "按结构化场景与问题标签进行启发式裁判。",
    rejectedRuleIds: ranked.slice(1).map((item) => item.candidate.ruleId),
  };
}

type JudgeLlmResult = {
  selectedRuleId?: string;
  confidence?: number;
  judgeReason?: string;
  rejectedRuleIds?: string[];
};

export async function judgeRegularQuestionCandidates(
  request: RegularQuestionRequest,
  intent: RegularQuestionIntentParse,
  candidates: RegularQuestionJudgeCandidate[],
): Promise<RegularQuestionJudgeDecision> {
  const heuristic = buildHeuristicJudgeDecision(request, intent, candidates);
  const apiKey = getDashScopeApiKey();
  if (!apiKey || candidates.length <= 1) {
    return heuristic;
  }

  const candidateBlock = candidates
    .map(
      (item, index) => `候选${index + 1}
- ruleId: ${item.ruleId}
- 标题: ${normalizeText(item.clauseTitle)}
- 判定结论: ${normalizeText(item.shouldDeduct)}
- 扣分分值: ${normalizeText(item.deductScore)}
- 条款片段: ${normalizeText(item.clauseSnippet)}
- 解释: ${normalizeText(item.explanation)}
- 当前排序分: ${item.score}
- 命中原因: ${formatMatchedReasons(item.matchedReasons)}`,
    )
    .join("\n\n");

  const prompt = `
请在候选规则中选择最适合当前问题的一条。禁止编造新 ruleId。

用户问题：
- 分类：${normalizeText(request.category)}
- 门店问题：${normalizeText(request.issueTitle)}
- 问题描述：${normalizeText(request.description)}
- 自行判断：${normalizeText(request.selfJudgment)}

结构化理解：
- 归一分类：${normalizeText(intent.normalizedCategory)}
- 场景标签：${intent.sceneTags.join("、") || "无"}
- 对象标签：${intent.objectTags.join("、") || "无"}
- 问题标签：${intent.issueTags.join("、") || "无"}
- 排除标签：${intent.exclusionTags.join("、") || "无"}
- 是否需人工核实：${intent.needsHumanVerification ? "是" : "否"}

候选规则：
${candidateBlock}

输出严格 JSON：
{
  "selectedRuleId": "候选中的 ruleId",
  "confidence": 0.0,
  "judgeReason": "一句中文原因",
  "rejectedRuleIds": ["被排除的 ruleId"]
}
`;

  const raw = await requestDashScope(
    "你是稽核规则裁判器。你只能从给定候选规则中选一条最合适的 ruleId，不能编造新规则；若问题明确排除了私人物品/个人食用，就不能选择相关规则。只输出 JSON。",
    prompt,
    { maxTokens: 240, responseFormat: "json_object" },
  );
  const parsed = parseJsonObject<JudgeLlmResult>(raw);
  const validIds = new Set(candidates.map((item) => item.ruleId));
  if (!parsed?.selectedRuleId || !validIds.has(parsed.selectedRuleId)) {
    return heuristic;
  }

  return {
    judgeMode: "llm",
    selectedRuleId: parsed.selectedRuleId,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(parsed.confidence, 1))
        : 0.78,
    judgeReason: parsed.judgeReason?.trim() || "LLM 在候选规则中完成裁判。",
    rejectedRuleIds: (parsed.rejectedRuleIds ?? []).filter((id) => validIds.has(id)),
  };
}

export async function generateRegularQuestionAiExplanation(
  request: RegularQuestionRequest,
  answer: RegularQuestionAnswer,
) {
  const conclusion = normalizeText(answer.shouldDeduct);
  const rulesBlock = `
【硬性对齐，必须遵守】
- 「判定结论」字段为：${conclusion}。
- 若判定结论为「是」：全文必须体现需要按规则扣分或需记录扣分情形，禁止写「不扣分」「本次不扣分」「不予扣分」等相反结论。
- 若判定结论为「否」：必须体现不扣分或仅提醒等与不扣分一致的含义，禁止写「应扣分」「需要扣分」等相反结论。
- 若判定结论为「按场景判定」：不得擅自给出「一定不扣分」或「一定扣分」的终局结论；应说明须结合现场与共识条款核对，必要时人工复核。
- 禁止编造「水浴/平冷/转移」等流程细节，除非这些词出现在下面的「条款片段」或「原始解释」中。
- 优先复述「原始解释」中的共识逻辑；可结合用户描述点出现场，但不得与判定结论矛盾。

用户提交信息：
- 问题分类：${normalizeText(request.category)}
- 门店问题：${normalizeText(request.issueTitle)}
- 问题描述：${normalizeText(request.description)}
- 自行判断：${normalizeText(request.selfJudgment)}

规则命中结果（稽核共识与规则表）：
- 判定结论：${conclusion}
- 扣分分值：${normalizeText(answer.deductScore)}
- 条款编号：${normalizeText(answer.clauseNo)}
- 条款标题：${normalizeText(answer.clauseTitle)}
- 条款片段：${normalizeText(answer.clauseSnippet)}
- 原始解释（共识正文）：${normalizeText(answer.explanation)}
- 共识关键词：${normalizeText(answer.consensusKeywords)}
- 适用场景：${normalizeText(answer.consensusApplicableScene)}
- 引用来源：${normalizeText(answer.source)}
- 规则命中原因：${formatMatchedReasons(answer.matchedReasons)}

输出要求：
1. 用 3 句以内、共 90～180 字，先说与判定结论一致的一句话，再依据「原始解释」压缩说明理由，最后一句给可执行建议。
2. 不要使用标题、编号、Markdown。
3. 若涉及效期，区分「赏味期」与「废弃时间」，且仅当条款中出现时才写。
`;

  const llm = await requestDashScopeExplanation(rulesBlock);
  if (llm) {
    return llm;
  }

  return buildDeterministicRegularQuestionExplanation(answer);
}

export async function generateOperationAiExplanation(
  request: RegularQuestionRequest,
  answer: RegularQuestionAnswer,
) {
  const prompt = `
请把下面的操作资料命中结果整理成给门店伙伴看的简短说明。

用户提交信息：
- 问题分类：${normalizeText(request.category)}
- 门店问题：${normalizeText(request.issueTitle)}
- 问题描述：${normalizeText(request.description)}
- 自行判断：${normalizeText(request.selfJudgment)}

资料命中结果：
- 资料标题：${normalizeText(answer.clauseTitle)}
- 资料类型：${normalizeText(answer.clauseNo)}
- 操作片段：${normalizeText(answer.clauseSnippet)}
- 解释说明：${normalizeText(answer.explanation)}
- 来源：${normalizeText(answer.source)}

输出要求：
1. 只依据以上信息，不编造新的配方、克数、流程或例外。
2. 先说命中了哪份操作资料，再压缩说明应关注的操作/检核点。
3. 最后补一句执行建议。
4. 控制在 3 句话以内，70 到 140 字。
5. 不要使用标题、编号、Markdown。
`;

  const llm = await requestDashScopeExplanation(prompt);
  if (llm) {
    return llm;
  }

  return buildDeterministicOperationExplanation(answer);
}

export async function generateExternalPurchaseAiExplanation(
  request: ExternalPurchaseRequest,
  answer: ExternalPurchaseAnswer,
) {
  return requestDashScopeExplanation(`
请把下面的外购判定结果整理成给门店同学看的简短解释。

用户提交信息：
- 物品名称：${normalizeText(request.name)}
- 补充描述：${normalizeText(request.description)}

规则命中结果：
- 命中物品：${normalizeText(answer.name)}
- 是否可外购：${normalizeText(answer.canPurchase)}
- 命中来源：${normalizeText(answer.sourceName)}
- 依据文件：${normalizeText(answer.sourceFile)}
- 原始说明：${normalizeText(answer.explanation)}

输出要求：
1. 只依据以上信息，不补充未知制度。
2. 先给结论，再解释为什么可外购或不可外购。
3. 最后补一句执行建议。
4. 控制在 3 句话以内，60 到 120 字。
5. 不要使用标题、编号、Markdown。
`);
}

export async function generateOldItemAiExplanation(
  request: OldItemRequest,
  answer: OldItemAnswer,
) {
  return requestDashScopeExplanation(`
请把下面的旧品比对结果整理成给门店同学看的简短解释。

用户提交信息：
- 物品名称：${normalizeText(request.name)}
- 备注说明：${normalizeText(request.remark)}

规则命中结果：
- 命中物品：${normalizeText(answer.name)}
- 是否旧品：${normalizeText(answer.isOldItem)}
- 命中清单：${normalizeText(answer.sourceName)}
- 识别备注：${normalizeText(answer.remark)}
- 参考图片：${normalizeText(answer.imageRef)}

输出要求：
1. 只依据以上信息，不补充未知事实。
2. 先给判定，再解释识别依据。
3. 最后补一句建议门店如何处理。
4. 控制在 3 句话以内，60 到 120 字。
5. 不要使用标题、编号、Markdown。
`);
}
