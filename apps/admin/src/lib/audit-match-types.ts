export type AuditClause = {
  key: string;
  rowIndex: number;
  auditId: string;
  dimension: string;
  level: string;
  score: number | null;
  clauseTitle: string;
  clauseDetail: string;
  searchText: string;
  rawRow: Record<string, string>;
};

export type ConsensusEntry = {
  key: string;
  rowIndex: number;
  consensusId: string;
  title: string;
  type: string;
  clauseId: string;
  contentText: string;
  visibleRoles: string;
  searchText: string;
  rawRow: Record<string, string>;
};

export type MatchCandidate = {
  consensusId: string;
  title: string;
  type: string;
  clauseId: string;
  contentText: string;
  keywordScore: number;
  semanticScore: number | null;
  finalScore: number;
  reasons: string[];
};

export type MatchStatus = "matched" | "review" | "unmatched";

export type AuditConsensusMatchResult = {
  auditKey: string;
  auditClause: AuditClause;
  bestMatch: MatchCandidate | null;
  candidates: MatchCandidate[];
  confidence: number;
  reasons: string[];
  reviewRequired: boolean;
  status: MatchStatus;
};

export type AuditConsensusMatchSummary = {
  totalAuditClauses: number;
  totalConsensus: number;
  matched: number;
  reviewRequired: number;
  unmatched: number;
  highConfidence: number;
  averageConfidence: number;
};

export type ParsedAuditWorkbook = {
  sheetNames: string[];
  clauses: AuditClause[];
  warnings: string[];
};

export type ParsedConsensusWorkbook = {
  sheetNames: string[];
  entries: ConsensusEntry[];
  warnings: string[];
};

export type AuditConsensusAnalysis = {
  auditSheets: string[];
  consensusSheets: string[];
  auditClauses: AuditClause[];
  consensusEntries: ConsensusEntry[];
  results: AuditConsensusMatchResult[];
  summary: AuditConsensusMatchSummary;
  warnings: string[];
};
