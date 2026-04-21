import { NextRequest, NextResponse } from "next/server";
import { formatZodError, logRouteError, readJsonBody } from "@/lib/api-utils";
import { generateExternalPurchaseAiExplanation } from "@/lib/ai";
import { rateLimit } from "@/lib/rate-limit";
import { matchExternalPurchase } from "@/lib/knowledge-base";
import { getRequesterPayloadFromRequest } from "@/lib/requester";
import { externalPurchaseBodySchema } from "@/lib/schemas";
import {
  createReviewTaskFromAnswer,
  createReviewTaskFromExternalPurchase,
} from "@/lib/review-pool";

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, "external-purchase-ask", 40);
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
    const parsed = externalPurchaseBodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message: formatZodError(parsed.error),
        },
        { status: 400 },
      );
    }
    const body = await getRequesterPayloadFromRequest(request, parsed.data);

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
    logRouteError("/api/external-purchase/ask", error);
    return NextResponse.json(
      {
        ok: false,
        message: "外购查询时发生异常，请稍后重试。",
      },
      { status: 500 },
    );
  }
}
