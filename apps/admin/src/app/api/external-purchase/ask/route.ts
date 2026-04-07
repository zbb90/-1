import { NextRequest, NextResponse } from "next/server";
import { generateExternalPurchaseAiExplanation } from "@/lib/ai";
import { rateLimit } from "@/lib/rate-limit";
import { matchExternalPurchase } from "@/lib/knowledge-base";
import { getRequesterPayloadFromRequest } from "@/lib/requester";
import {
  createReviewTaskFromAnswer,
  createReviewTaskFromExternalPurchase,
} from "@/lib/review-pool";
import type { ExternalPurchaseRequest } from "@/lib/types";

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "external-purchase-ask", 40);
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
    const body = getRequesterPayloadFromRequest(
      request,
      (await request.json()) as ExternalPurchaseRequest,
    );

    if (!body.name?.trim() && !body.description?.trim()) {
      return NextResponse.json(
        {
          ok: false,
          message: "至少需要提供物品名称或补充描述。",
        },
        { status: 400 },
      );
    }

    const result = await matchExternalPurchase(body);
    if (!result.matched) {
      const rejectReason =
        result.rejectReason || "未找到明确外购依据，建议进入人工复核池。";
      const reviewTask = await createReviewTaskFromExternalPurchase(body, rejectReason);

      return NextResponse.json({
        ok: true,
        data: {
          ...result,
          rejectReason,
          reviewTask: {
            id: reviewTask.id,
            status: reviewTask.status,
          },
        },
      });
    }

    if (!result.answer) {
      throw new Error("外购命中成功，但未生成答案内容。");
    }

    const aiExplanation = await generateExternalPurchaseAiExplanation(
      body,
      result.answer,
    );

    const answerWithAI = { ...result.answer, aiExplanation };

    const reviewTask = await createReviewTaskFromAnswer({
      type: "外购查询",
      request: body,
      answer: answerWithAI,
      aiExplanation: aiExplanation ?? undefined,
      category: "外购与非认可物料/器具",
      description: [body.name, body.description].filter(Boolean).join("｜"),
    });

    return NextResponse.json({
      ok: true,
      data: {
        ...result,
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
        message: error instanceof Error ? error.message : "外购查询时发生异常",
      },
      { status: 500 },
    );
  }
}
