import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { logRouteError, readJsonBody } from "@/lib/api-utils";
import { rateLimit } from "@/lib/rate-limit";
import { searchKnowledgeVectorsByText } from "@/lib/vector-store";
import type { KbTableName } from "@/lib/kb-schema";
import type { KnowledgeRecallKind } from "@/lib/types";

export const dynamic = "force-dynamic";

type SuggestionBody = {
  table: KbTableName;
  draft?: Record<string, unknown>;
  topN?: number;
};

type SuggestionItem = {
  table: "rules" | "consensus" | "faq";
  id: string;
  label: string;
  score: number;
};

const DEFAULT_TOP_N = Number(process.env.LINK_SUGGEST_ON_CREATE_TOPN || 3) || 3;

function pickStr(record: Record<string, unknown> | undefined, key: string): string {
  if (!record) return "";
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function buildQueryText(
  table: KbTableName,
  draft: Record<string, unknown> | undefined,
) {
  const parts: string[] = [];
  if (table === "rules") {
    parts.push(
      pickStr(draft, "条款标题"),
      pickStr(draft, "条款关键片段"),
      pickStr(draft, "条款解释"),
      pickStr(draft, "场景描述"),
      pickStr(draft, "问题子类或关键词"),
      pickStr(draft, "示例问法"),
    );
  } else if (table === "consensus") {
    parts.push(
      pickStr(draft, "标题"),
      pickStr(draft, "适用场景"),
      pickStr(draft, "解释内容"),
      pickStr(draft, "判定结果"),
      pickStr(draft, "关键词"),
      pickStr(draft, "示例问题"),
    );
  } else if (table === "faq") {
    parts.push(
      pickStr(draft, "问题"),
      pickStr(draft, "答案"),
      pickStr(draft, "命中关键词"),
    );
  } else if (table === "external-purchases" || table === "old-items") {
    parts.push(
      pickStr(draft, "物品名称"),
      pickStr(draft, "别名或关键词"),
      pickStr(draft, "别名或常见叫法"),
      pickStr(draft, "说明"),
      pickStr(draft, "识别备注"),
    );
  } else if (table === "operations") {
    parts.push(
      pickStr(draft, "标题"),
      pickStr(draft, "适用对象"),
      pickStr(draft, "关键词"),
      pickStr(draft, "操作内容"),
      pickStr(draft, "解释说明"),
    );
  }
  return parts.filter(Boolean).join("\n");
}

function recallKinds(table: KbTableName): KnowledgeRecallKind[] {
  // 录入时建联只关心三个核心层：rule / consensus / faq；剔除自身层。
  if (table === "rules") return ["consensus", "faq"];
  if (table === "consensus") return ["rule", "faq"];
  if (table === "faq") return ["rule", "consensus"];
  return ["rule", "consensus", "faq"];
}

function selfId(
  table: KbTableName,
  draft: Record<string, unknown> | undefined,
): string {
  if (!draft) return "";
  const idKey =
    table === "rules"
      ? "rule_id"
      : table === "consensus"
        ? "consensus_id"
        : table === "faq"
          ? "faq_id"
          : table === "operations"
            ? "op_id"
            : "item_id";
  return pickStr(draft, idKey);
}

export async function POST(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  // 失焦自动调用，限流稍宽松：30 次/分钟。
  const limited = await rateLimit(request, "knowledge-link-suggest-on-create", 30);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, message: "建议请求过于频繁，请稍后再试。" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  try {
    const body = (await readJsonBody(request)) as SuggestionBody | null;
    if (!body?.table) {
      return NextResponse.json(
        { ok: false, message: "缺少 table 参数。" },
        { status: 400 },
      );
    }
    const queryText = buildQueryText(body.table, body.draft);
    if (!queryText) {
      return NextResponse.json({ ok: true, data: { items: [] as SuggestionItem[] } });
    }

    const topN = Math.min(10, Math.max(1, body.topN ?? DEFAULT_TOP_N));
    const result = await searchKnowledgeVectorsByText(queryText, {
      limit: topN * 3,
      kinds: recallKinds(body.table),
    });

    const myId = selfId(body.table, body.draft);
    const items: SuggestionItem[] = [];

    for (const hit of result.hits) {
      if (hit.kind === "rule") {
        if (body.table === "rules" && hit.rule.ruleId === myId) continue;
        items.push({
          table: "rules",
          id: hit.rule.ruleId,
          label: `${hit.rule.ruleId}｜${hit.rule.clauseTitle}`,
          score: hit.rule.vectorScore,
        });
      } else if (hit.kind === "consensus") {
        if (body.table === "consensus" && hit.consensus.consensusId === myId) continue;
        items.push({
          table: "consensus",
          id: hit.consensus.consensusId,
          label: `${hit.consensus.consensusId}｜${hit.consensus.title}`,
          score: hit.consensus.vectorScore,
        });
      } else if (hit.kind === "faq") {
        if (body.table === "faq" && hit.faq.faqId === myId) continue;
        items.push({
          table: "faq",
          id: hit.faq.faqId,
          label: `${hit.faq.faqId}｜${hit.faq.question}`,
          score: hit.faq.vectorScore,
        });
      }
      if (items.length >= topN) break;
    }

    return NextResponse.json({
      ok: true,
      data: {
        queryText: result.queryText,
        items,
        fallbackReason: result.fallbackReason,
      },
    });
  } catch (error) {
    logRouteError("/api/knowledge/links/suggest-on-create", error);
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "生成建议失败",
      },
      { status: 500 },
    );
  }
}
