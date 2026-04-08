import { NextRequest, NextResponse } from "next/server";
import { formatZodError, logRouteError, readJsonBody } from "@/lib/api-utils";
import { createReviewTask } from "@/lib/review-pool";
import { getRequesterPayloadFromRequest } from "@/lib/requester";
import { manualReviewBodySchema } from "@/lib/schemas";

export async function POST(request: NextRequest) {
  try {
    const parsed = manualReviewBodySchema.safeParse(await readJsonBody(request));
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
    logRouteError("/api/regular-question/review", error);
    return NextResponse.json(
      {
        ok: false,
        message: "创建人工复核任务时发生异常，请稍后重试。",
      },
      { status: 500 },
    );
  }
}
