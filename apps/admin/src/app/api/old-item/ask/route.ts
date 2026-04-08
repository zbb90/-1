import { NextRequest, NextResponse } from "next/server";
import { formatZodError, logRouteError, readJsonBody } from "@/lib/api-utils";
import { generateOldItemAiExplanation } from "@/lib/ai";
import { rateLimit } from "@/lib/rate-limit";
import { matchOldItem } from "@/lib/knowledge-base";
import { getRequesterPayloadFromRequest } from "@/lib/requester";
import { oldItemBodySchema } from "@/lib/schemas";
import {
  createReviewTaskFromAnswer,
  createReviewTaskFromOldItem,
} from "@/lib/review-pool";

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "old-item-ask", 40);
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
    const parsed = oldItemBodySchema.safeParse(await readJsonBody(request));
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

    const result = await matchOldItem(body);
    if (!result.matched) {
      const rejectReason =
        result.rejectReason || "未找到明确旧品依据，建议进入人工复核池。";
      const reviewTask = await createReviewTaskFromOldItem(body, rejectReason);

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
      throw new Error("旧品命中成功，但未生成答案内容。");
    }

    const aiExplanation = await generateOldItemAiExplanation(body, result.answer);

    const answerWithAI = { ...result.answer, aiExplanation };

    const reviewTask = await createReviewTaskFromAnswer({
      type: "旧品比对",
      request: body,
      answer: answerWithAI,
      aiExplanation: aiExplanation ?? undefined,
      category: "旧品比对",
      description: [body.name, body.remark].filter(Boolean).join("｜"),
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
    logRouteError("/api/old-item/ask", error);
    return NextResponse.json(
      {
        ok: false,
        message: "旧品比对时发生异常，请稍后重试。",
      },
      { status: 500 },
    );
  }
}
