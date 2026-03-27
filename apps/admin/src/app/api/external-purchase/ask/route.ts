import { NextRequest, NextResponse } from "next/server";
import { matchExternalPurchase } from "@/lib/knowledge-base";
import { getRequesterPayloadFromRequest } from "@/lib/requester";
import { createReviewTaskFromExternalPurchase } from "@/lib/review-pool";
import type { ExternalPurchaseRequest } from "@/lib/types";

export async function POST(request: NextRequest) {
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
      const reviewTask = await createReviewTaskFromExternalPurchase(
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

    return NextResponse.json({
      ok: true,
      data: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "外购查询时发生异常",
      },
      { status: 500 },
    );
  }
}
