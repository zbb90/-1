import { NextRequest, NextResponse } from "next/server";
import { generateOldItemAiExplanation } from "@/lib/ai";
import { matchOldItem } from "@/lib/knowledge-base";
import { getRequesterPayloadFromRequest } from "@/lib/requester";
import { createReviewTaskFromOldItem } from "@/lib/review-pool";
import type { OldItemRequest } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = getRequesterPayloadFromRequest(
      request,
      (await request.json()) as OldItemRequest,
    );

    if (!body.name?.trim() && !body.remark?.trim()) {
      return NextResponse.json(
        {
          ok: false,
          message: "至少需要提供物品名称或备注说明。",
        },
        { status: 400 },
      );
    }

    const result = await matchOldItem(body);
    if (!result.matched) {
      const rejectReason =
        result.rejectReason || "未找到明确旧品依据，建议进入人工复核池。";
      const reviewTask = await createReviewTaskFromOldItem(
        body,
        rejectReason,
      );

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

    const aiExplanation = await generateOldItemAiExplanation(
      body,
      result.answer,
    );

    return NextResponse.json({
      ok: true,
      data: {
        ...result,
        answer: {
          ...result.answer,
          aiExplanation,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "旧品比对时发生异常",
      },
      { status: 500 },
    );
  }
}
