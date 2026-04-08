import { NextRequest, NextResponse } from "next/server";
import { formatZodError, logRouteError, readJsonBody } from "@/lib/api-utils";
import {
  generateOperationAiExplanation,
  generateRegularQuestionAiExplanation,
} from "@/lib/ai";
import { rateLimit } from "@/lib/rate-limit";
import { matchOperationQuestion, matchRegularQuestion } from "@/lib/knowledge-base";
import { getRequesterPayloadFromRequest } from "@/lib/requester";
import { regularQuestionBodySchema } from "@/lib/schemas";
import {
  createReviewTaskFromAnswer,
  createReviewTaskFromRegularQuestion,
} from "@/lib/review-pool";

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "regular-question-ask", 40);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, message: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  try {
    const parsed = regularQuestionBodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message: formatZodError(parsed.error),
        },
        { status: 400 },
      );
    }
    const payload = await getRequesterPayloadFromRequest(request, parsed.data);
    const requestSnapshot = {
      storeCode: payload.storeCode,
      category: payload.category,
      selfJudgment: payload.selfJudgment,
      issueTitle: payload.issueTitle,
      description: payload.description,
      requesterId: payload.requesterId,
      requesterName: payload.requesterName,
    };

    const operationResult = await matchOperationQuestion(payload);
    const result = operationResult ?? (await matchRegularQuestion(payload));
    if (!result.matched) {
      const rejectReason =
        result.rejectReason || "未找到明确依据，建议进入人工复核池。";
      const reviewTask = await createReviewTaskFromRegularQuestion(
        payload,
        rejectReason,
      );

      return NextResponse.json({
        ok: true,
        data: {
          ...result,
          matchingDebug: result.debug,
          rejectReason,
          requestSnapshot,
          reviewTask: {
            id: reviewTask.id,
            status: reviewTask.status,
          },
        },
      });
    }

    if (!result.answer) {
      throw new Error("规则命中成功，但未生成答案内容。");
    }

    const aiExplanation =
      result.answer.category === "操作标准"
        ? await generateOperationAiExplanation(payload, result.answer)
        : await generateRegularQuestionAiExplanation(payload, result.answer);

    const answerWithAI = { ...result.answer, aiExplanation };

    const reviewTask = await createReviewTaskFromAnswer({
      type: "常规问题",
      request: payload,
      answer: answerWithAI,
      aiExplanation,
      storeCode: payload.storeCode,
      category: payload.category,
      selfJudgment: payload.selfJudgment,
      description: payload.description || payload.issueTitle,
    });

    return NextResponse.json({
      ok: true,
      data: {
        ...result,
        matchingDebug: result.debug,
        requestSnapshot,
        answer: answerWithAI,
        reviewTask: {
          id: reviewTask.id,
          status: reviewTask.status,
        },
      },
    });
  } catch (error) {
    logRouteError("/api/regular-question/ask", error);
    return NextResponse.json(
      {
        ok: false,
        message: "常规问题检索时发生异常，请稍后重试。",
      },
      { status: 500 },
    );
  }
}
