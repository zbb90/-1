import { NextRequest, NextResponse } from "next/server";
import { generateRegularQuestionAiExplanation } from "@/lib/ai";
import { matchRegularQuestion } from "@/lib/knowledge-base";
import { getRequesterPayloadFromRequest } from "@/lib/requester";
import {
  createReviewTaskFromAnswer,
  createReviewTaskFromRegularQuestion,
} from "@/lib/review-pool";
import type { RegularQuestionRequest } from "@/lib/types";

function validateBody(body: RegularQuestionRequest) {
  if (!body.description?.trim() && !body.issueTitle?.trim()) {
    return "至少需要提供 `问题描述` 或 `门店问题`。";
  }

  if (!body.category?.trim()) {
    return "`问题分类` 不能为空。";
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const payload = getRequesterPayloadFromRequest(
      request,
      (await request.json()) as RegularQuestionRequest,
    );
    const requestSnapshot = {
      storeCode: payload.storeCode,
      category: payload.category,
      selfJudgment: payload.selfJudgment,
      issueTitle: payload.issueTitle,
      description: payload.description,
      requesterId: payload.requesterId,
      requesterName: payload.requesterName,
    };
    const errorMessage = validateBody(payload);

    if (errorMessage) {
      return NextResponse.json(
        {
          ok: false,
          message: errorMessage,
        },
        { status: 400 },
      );
    }

    const result = await matchRegularQuestion(payload);
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

    const aiExplanation = await generateRegularQuestionAiExplanation(
      payload,
      result.answer,
    );

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
        requestSnapshot,
        answer: answerWithAI,
        reviewTask: {
          id: reviewTask.id,
          status: reviewTask.status,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "常规问题检索时发生异常",
      },
      { status: 500 },
    );
  }
}
