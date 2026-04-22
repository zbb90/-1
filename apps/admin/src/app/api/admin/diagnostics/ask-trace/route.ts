/**
 * Leader 专用诊断接口：模拟 /api/regular-question/ask 的核心检索流程，
 * 把真实错误（含栈）原样返回，便于在 Railway 控制台之外快速定位。
 *
 * 不会创建 review pool 任务，不会调用 LLM 解释，
 * 仅跑 matchOperationQuestion + matchRegularQuestion 的最小路径。
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { matchOperationQuestion, matchRegularQuestion } from "@/lib/knowledge-base";
import { isSemanticSearchConfigured } from "@/lib/vector-store";
import type { RegularQuestionRequest } from "@/lib/types";

async function requireLeader() {
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  return session?.role === "leader";
}

interface Stage {
  name: string;
  ok: boolean;
  ms: number;
  error?: { name: string; message: string; stack?: string };
  data?: unknown;
}

async function runStage<T>(name: string, fn: () => Promise<T>): Promise<Stage> {
  const t0 = Date.now();
  try {
    const data = await fn();
    return { name, ok: true, ms: Date.now() - t0, data };
  } catch (error) {
    return {
      name,
      ok: false,
      ms: Date.now() - t0,
      error: {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireLeader())) {
    return NextResponse.json({ ok: false, message: "需要领导身份。" }, { status: 401 });
  }

  let payload: Partial<RegularQuestionRequest> = {};
  try {
    payload = (await request.json()) as Partial<RegularQuestionRequest>;
  } catch {
    payload = {};
  }
  const fullPayload: RegularQuestionRequest = {
    storeCode: payload.storeCode || "DIAG",
    category: payload.category || "诊断",
    selfJudgment: payload.selfJudgment || "",
    issueTitle: payload.issueTitle || "诊断：随便问一个问题",
    description: payload.description || "诊断：随便问一个问题",
  };

  const stages: Stage[] = [];

  stages.push({
    name: "env",
    ok: true,
    ms: 0,
    data: {
      semanticEnabled: isSemanticSearchConfigured(),
      hasDashScopeKey: Boolean(process.env.DASHSCOPE_API_KEY),
      hasQdrantUrl: Boolean(process.env.QDRANT_URL),
      hasQdrantKey: Boolean(process.env.QDRANT_API_KEY),
    },
  });

  stages.push(
    await runStage("matchOperationQuestion", async () => {
      const r = await matchOperationQuestion(fullPayload);
      if (!r) return null;
      return {
        matched: r.matched,
        hasAnswer: r.matched && Boolean((r as { answer?: unknown }).answer),
      };
    }),
  );

  stages.push(
    await runStage("matchRegularQuestion", async () => {
      const r = await matchRegularQuestion(fullPayload);
      const debug = (
        r as {
          debug?: {
            retrievalMode?: string;
            fallbackReason?: string;
            recalled?: unknown[];
          };
        }
      ).debug;
      return {
        matched: r.matched,
        hasAnswer: r.matched && Boolean((r as { answer?: unknown }).answer),
        retrievalMode: debug?.retrievalMode,
        fallbackReason: debug?.fallbackReason,
        recalledCount: debug?.recalled?.length ?? 0,
      };
    }),
  );

  return NextResponse.json({ ok: true, stages, payload: fullPayload });
}
