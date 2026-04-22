import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { rateLimit } from "@/lib/rate-limit";
import { readRows } from "@/lib/knowledge-store";
import {
  isSemanticSearchConfigured,
  rebuildKnowledgeVectorIndex,
  rebuildRuleVectorIndex,
  upsertConsensusVectors,
} from "@/lib/vector-store";
import type { ConsensusRow, RuleRow } from "@/lib/types";

type ReindexTarget = "rules" | "consensus" | "all";

function resolveTarget(raw: unknown): ReindexTarget {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "rules" || value === "consensus" || value === "all") return value;
  return "all";
}

export async function POST(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  // 重建索引会调用 DashScope embedding API，控制频率避免误触发。
  const limited = await rateLimit(request, "knowledge-reindex", 3);
  if (!limited.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: `操作过于频繁，请 ${limited.retryAfterSec} 秒后再试。`,
      },
      { status: 429 },
    );
  }

  if (!isSemanticSearchConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        message: "向量检索未配置（DashScope Embedding 或 Qdrant 缺失），无法执行重建。",
      },
      { status: 503 },
    );
  }

  let payload: { target?: string } = {};
  try {
    payload = (await request.json().catch(() => ({}))) as { target?: string };
  } catch {
    payload = {};
  }
  const target = resolveTarget(payload.target);

  try {
    if (target === "rules") {
      const rules = (await readRows("rules")) as unknown as RuleRow[];
      const result = await rebuildRuleVectorIndex(rules);
      return NextResponse.json({
        ok: result.ok,
        target,
        message: result.ok
          ? `已重建规则索引，共 ${result.count} 条。`
          : `规则索引重建失败：${result.reason}`,
        data: result,
      });
    }

    if (target === "consensus") {
      const consensus = (await readRows("consensus")) as unknown as ConsensusRow[];
      const enabled = consensus.filter((row) => row.状态 !== "停用");
      const result = await upsertConsensusVectors(enabled);
      return NextResponse.json({
        ok: result.ok,
        target,
        message: result.ok
          ? `已同步共识向量，共 ${result.count} 条。`
          : `共识向量同步失败：${result.reason}`,
        data: result,
      });
    }

    const [rules, consensus] = await Promise.all([
      readRows("rules") as Promise<unknown> as Promise<RuleRow[]>,
      readRows("consensus") as Promise<unknown> as Promise<ConsensusRow[]>,
    ]);
    const result = await rebuildKnowledgeVectorIndex(rules, consensus);

    return NextResponse.json({
      ok: result.ok,
      target,
      message: result.ok
        ? `已重建知识向量库：规则 ${result.rules} 条、共识 ${result.consensus} 条。`
        : `部分失败：${result.ruleReason || result.consensusReason || "未知原因"}`,
      data: result,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "重建失败" },
      { status: 500 },
    );
  }
}
