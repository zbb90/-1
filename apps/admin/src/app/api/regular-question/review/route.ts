import { NextRequest, NextResponse } from "next/server";
import { createReviewTask } from "@/lib/review-pool";
import { getRequesterPayloadFromRequest } from "@/lib/requester";
import type { RegularQuestionRequest } from "@/lib/types";

type ManualReviewRequest = RegularQuestionRequest & {
  answer?: {
    ruleId?: string;
    category?: string;
    shouldDeduct?: string;
    deductScore?: string;
    clauseNo?: string;
    clauseTitle?: string;
    clauseSnippet?: string;
    explanation?: string;
    source?: string;
    matchedReasons?: string[];
    aiExplanation?: string;
  };
  candidates?: Array<{
    ruleId?: string;
    category?: string;
    clauseNo?: string;
    clauseTitle?: string;
    score?: number;
  }>;
};

function validateBody(body: ManualReviewRequest) {
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
      (await request.json()) as ManualReviewRequest,
    );
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

    const reviewTask = await createReviewTask({
      type: "常规问题",
      requesterId: payload.requesterId,
      requesterName: payload.requesterName,
      storeCode: payload.storeCode,
      category: payload.category,
      selfJudgment: payload.selfJudgment,
      description: payload.description || payload.issueTitle,
      rejectReason: "用户对自动判定结果有异议，主动发起人工复核。",
      sourcePayload: {
        request: {
          storeCode: payload.storeCode,
          category: payload.category,
          selfJudgment: payload.selfJudgment,
          issueTitle: payload.issueTitle,
          description: payload.description,
          requesterId: payload.requesterId,
          requesterName: payload.requesterName,
        },
        autoAnswer: payload.answer ?? null,
        candidates: payload.candidates ?? [],
        reviewSource: "manual-from-miniprogram",
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
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
          error instanceof Error ? error.message : "创建人工复核任务时发生异常",
      },
      { status: 500 },
    );
  }
}
