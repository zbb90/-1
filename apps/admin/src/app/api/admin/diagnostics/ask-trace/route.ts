/**
 * Leader 专用诊断接口：完整模拟 /api/regular-question/ask 的所有阶段，
 * 把真实错误（含栈）原样返回，便于在 Railway 控制台之外快速定位。
 *
 * 覆盖阶段：env / matchRegular / matchOperation(兜底) / aiExplanation /
 * createReviewTask（默认 dryRun，不真正写复核池）。
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import {
  generateOperationAiExplanation,
  generateRegularQuestionAiExplanation,
} from "@/lib/ai";
import { matchOperationQuestion, matchRegularQuestion } from "@/lib/knowledge-base";
import {
  createReviewTaskFromAnswer,
  createReviewTaskFromRegularQuestion,
} from "@/lib/review-pool";
import { isSemanticSearchConfigured } from "@/lib/vector-store";
import type { RegularQuestionAnswerPayload, RegularQuestionRequest } from "@/lib/types";

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

function summarizeMatchResult(
  result: Awaited<ReturnType<typeof matchRegularQuestion>> | null,
) {
  if (!result) return null;
  const debug = result.debug;
  return {
    matched: result.matched,
    hasAnswer: result.matched && Boolean((result as { answer?: unknown }).answer),
    retrievalMode: debug?.retrievalMode,
    fallbackReason: debug?.fallbackReason,
    recalledCount: debug?.recalled?.length ?? 0,
    selectedRuleId: debug?.judgeSelectedRuleId,
    sourceKind: result.matched ? result.answer.sourceKind : undefined,
    answerRuleId: result.matched ? result.answer.ruleId : undefined,
    answerTitle: result.matched ? result.answer.clauseTitle : undefined,
  };
}

export async function POST(request: NextRequest) {
  if (!(await requireLeader())) {
    return NextResponse.json({ ok: false, message: "需要领导身份。" }, { status: 401 });
  }

  let payload: Partial<RegularQuestionRequest> & { dryRun?: boolean } = {};
  try {
    payload = (await request.json()) as Partial<RegularQuestionRequest> & {
      dryRun?: boolean;
    };
  } catch {
    payload = {};
  }
  const dryRun = payload.dryRun !== false;
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
      dryRun,
    },
  });

  type MatchResult = Awaited<ReturnType<typeof matchRegularQuestion>>;
  let regResult = null as MatchResult | null;
  let opResult = null as MatchResult | null;

  stages.push(
    await runStage("matchRegularQuestion", async () => {
      const r = (await matchRegularQuestion(fullPayload)) as MatchResult;
      regResult = r;
      return summarizeMatchResult(r);
    }),
  );

  stages.push(
    await runStage("matchOperationQuestion (兜底)", async () => {
      if (regResult?.matched) {
        return { skipped: true, reason: "matchRegularQuestion 已命中" };
      }
      const r = (await matchOperationQuestion(fullPayload)) as MatchResult | null;
      opResult = r;
      return summarizeMatchResult(r);
    }),
  );

  const finalResult = (
    regResult?.matched ? regResult : (opResult ?? regResult)
  ) as MatchResult | null;
  const matchedAnswer: RegularQuestionAnswerPayload | undefined =
    finalResult && finalResult.matched
      ? (finalResult as { answer?: RegularQuestionAnswerPayload }).answer
      : undefined;

  let aiExplanation = matchedAnswer?.aiExplanation || "";
  if (matchedAnswer) {
    stages.push(
      await runStage("aiExplanation", async () => {
        if (matchedAnswer.aiExplanation) {
          return { skipped: true, reason: "result.answer.aiExplanation 已存在" };
        }
        aiExplanation =
          matchedAnswer.category === "操作标准"
            ? await generateOperationAiExplanation(fullPayload, matchedAnswer)
            : await generateRegularQuestionAiExplanation(fullPayload, matchedAnswer);
        return { length: aiExplanation?.length ?? 0 };
      }),
    );
  }

  stages.push(
    await runStage("createReviewTask", async () => {
      if (dryRun) {
        return { skipped: true, reason: "dryRun = true（默认）" };
      }
      if (!finalResult) {
        return { skipped: true, reason: "finalResult 为空" };
      }
      if (finalResult.matched && matchedAnswer) {
        const answerWithAI = { ...matchedAnswer, aiExplanation };
        const task = await createReviewTaskFromAnswer({
          type: "常规问题",
          request: fullPayload,
          answer: answerWithAI,
          aiExplanation,
          matchingDebug: finalResult.debug,
          storeCode: fullPayload.storeCode,
          category: fullPayload.category,
          selfJudgment: fullPayload.selfJudgment,
          description: fullPayload.description || fullPayload.issueTitle,
        });
        return { taskId: task.id, status: task.status };
      }
      const rejectReason =
        (finalResult as { rejectReason?: string }).rejectReason ||
        "未找到明确依据，建议进入人工复核池。";
      const task = await createReviewTaskFromRegularQuestion(
        fullPayload,
        rejectReason,
        finalResult.debug,
      );
      return { taskId: task.id, status: task.status };
    }),
  );

  return NextResponse.json({ ok: true, stages, payload: fullPayload, dryRun });
}
