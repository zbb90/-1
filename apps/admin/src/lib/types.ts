export interface RuleRow {
  rule_id: string;
  问题分类: string;
  问题子类或关键词: string;
  场景描述: string;
  触发条件: string;
  是否扣分: string;
  扣分分值: string;
  条款编号: string;
  条款标题: string;
  条款关键片段: string;
  条款解释: string;
  共识来源: string;
  示例问法: string;
  状态: string;
  备注: string;
  tags: string;
}

export interface ConsensusRow {
  consensus_id: string;
  标题: string;
  关联条款编号: string;
  适用场景: string;
  解释内容: string;
  判定结果: string;
  扣分分值: string;
  关键词: string;
  示例问题: string;
  来源文件: string;
  更新时间: string;
  状态: string;
  备注: string;
  tags: string;
}

export interface ExternalPurchaseRow {
  item_id: string;
  物品名称: string;
  别名或关键词: string;
  是否允许外购: string;
  命中的清单或共识名称: string;
  依据来源: string;
  说明: string;
  状态: string;
  备注: string;
  tags: string;
}

export interface OldItemRow {
  item_id: string;
  物品名称: string;
  别名或常见叫法: string;
  是否旧品: string;
  命中的清单名称: string;
  识别备注: string;
  参考图片名称: string;
  状态: string;
  备注: string;
  tags: string;
}

export interface OperationRow {
  op_id: string;
  资料类型: string;
  标题: string;
  适用对象: string;
  关键词: string;
  操作内容: string;
  检核要点: string;
  解释说明: string;
  来源文件: string;
  状态: string;
  备注: string;
  tags: string;
}

export interface ProductionCheckRow {
  check_id: string;
  来源文件: string;
  区域: string;
  产品名称: string;
  产品别名: string;
  风险分类: string;
  检核类型: string;
  检查点: string;
  违规表达: string;
  解释说明: string;
  判定口径: string;
  关联操作编号: string;
  关联条款编号: string;
  关联共识编号: string;
  状态: string;
  备注: string;
  tags: string;
}

export interface FaqRow {
  faq_id: string;
  问题: string;
  答案: string;
  关联条款编号: string;
  关联共识编号: string;
  review_id: string;
  沉积来源: string;
  命中关键词: string;
  tags: string;
  状态: string;
  备注: string;
  更新时间: string;
}

export interface KnowledgeBase {
  rules: RuleRow[];
  consensus: ConsensusRow[];
  externalPurchases: ExternalPurchaseRow[];
  oldItems: OldItemRow[];
  operations: OperationRow[];
  productionChecks: ProductionCheckRow[];
  faq: FaqRow[];
}

export interface RequesterPayload {
  requesterId?: string;
  requesterName?: string;
}

export interface RegularQuestionRequest extends RequesterPayload {
  storeCode?: string;
  category?: string;
  selfJudgment?: string;
  issueTitle?: string;
  description?: string;
}

export interface ExternalPurchaseRequest extends RequesterPayload {
  name?: string;
  description?: string;
}

export interface OldItemRequest extends RequesterPayload {
  name?: string;
  remark?: string;
}

export type KnowledgeRecallKind =
  | "rule"
  | "consensus"
  | "faq"
  | "operation"
  | "production-check";

export interface SemanticRuleRecallCandidate {
  ruleId: string;
  category: string;
  clauseTitle: string;
  vectorScore: number;
  kind?: KnowledgeRecallKind;
  consensusId?: string;
}

export interface SemanticConsensusRecallCandidate {
  consensusId: string;
  title: string;
  applicableScene: string;
  vectorScore: number;
  relatedClauseNo?: string;
}

export interface SemanticFaqRecallCandidate {
  faqId: string;
  question: string;
  answer: string;
  vectorScore: number;
  relatedClauseNo?: string;
  relatedConsensusNo?: string;
}

export interface RegularQuestionAnswerPayload {
  ruleId: string;
  category: string;
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
  aiExplanation?: string;
  // 命中来源类型：rule = 命中规则；consensus = 直接命中共识；faq = 命中常问沉积。
  sourceKind?: KnowledgeRecallKind;
  // 当 sourceKind = consensus 时，记录命中的共识 ID；ruleId 字段会留空或填该共识 ID。
  consensusId?: string;
}

export interface RegularQuestionCandidatePayload {
  ruleId: string;
  category: string;
  clauseNo: string;
  clauseTitle: string;
  score: number;
  vectorScore?: number;
  vectorBoost?: number;
}

export interface RegularQuestionIntentParse {
  normalizedCategory: string;
  sceneTags: string[];
  objectTags: string[];
  issueTags: string[];
  claimTags: string[];
  exclusionTags: string[];
  negationTags: string[];
  complexitySignals: string[];
  isComplex: boolean;
  needsHumanVerification: boolean;
  parseMode: "llm" | "heuristic" | "fallback";
  summary: string;
}

export type RegularQuestionJudgeMode =
  | "legacy"
  | "llm"
  | "heuristic"
  | "fallback"
  | "score-gap";

export interface RegularQuestionJudgeDecision {
  judgeMode: RegularQuestionJudgeMode;
  selectedRuleId: string;
  confidence: number;
  judgeReason: string;
  rejectedRuleIds: string[];
}

export interface RegularQuestionMatchDebug {
  retrievalMode:
    | "semantic"
    | "fallback"
    | "operation"
    | "production-check"
    | "scenario-policy";
  semanticEnabled: boolean;
  queryText: string;
  fallbackReason?: string;
  recalled: SemanticRuleRecallCandidate[];
  keywordRecalled?: Array<{
    ruleId: string;
    category: string;
    clauseTitle: string;
    lexicalScore: number;
  }>;
  gatedRuleIds?: string[];
  retrievalSources?: string[];
  rerankedTop?: RegularQuestionCandidatePayload[];
  intentParse?: RegularQuestionIntentParse;
  consensusGate?: {
    allowed: boolean;
    consensusId?: string;
    reason: string;
  };
  judgeMode?: RegularQuestionJudgeMode;
  judgeSelectedRuleId?: string;
  judgeReason?: string;
  judgeConfidence?: number;
  judgeRejectedRuleIds?: string[];
  usedComplexModel?: boolean;
  escalatedToReview?: boolean;
  lowConfidenceReason?: string;
}

export type RegularQuestionMatchResult =
  | {
      matched: false;
      rejectReason: string;
      candidates: RegularQuestionCandidatePayload[];
      debug: RegularQuestionMatchDebug;
    }
  | {
      matched: true;
      topScore: number;
      answer: RegularQuestionAnswerPayload;
      candidates: RegularQuestionCandidatePayload[];
      debug: RegularQuestionMatchDebug;
    };

export type ReviewTaskType = "常规问题" | "旧品比对" | "外购查询";

export type ReviewTaskStatus =
  | "待处理"
  | "AI已自动回答"
  | "已处理"
  | "已加入知识库"
  | "待补充";

export interface ReviewTask {
  id: string;
  type: ReviewTaskType;
  status: ReviewTaskStatus;
  createdAt: string;
  updatedAt: string;
  replyPublishedAt?: string;
  requesterLastViewedAt?: string;
  requesterId?: string;
  requester: string;
  storeCode: string;
  category: string;
  selfJudgment: string;
  description: string;
  imageNotes: string;
  rejectReason: string;
  finalConclusion: string;
  finalScore: string;
  finalClause: string;
  finalExplanation: string;
  processor: string;
  sourcePayload: string;
}
