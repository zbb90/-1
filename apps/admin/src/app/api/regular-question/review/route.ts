import { NextRequest, NextResponse } from "next/server";
import { formatZodError, logRouteError, readJsonBody } from "@/lib/api-utils";
import { rateLimit } from "@/lib/rate-limit";
import { createReviewTask } from "@/lib/review-pool";
import { getRequesterPayloadFromRequest } from "@/lib/requester";
import { manualReviewBodySchema } from "@/lib/schemas";

export async function POST(request: NextRequest) {
  // 与 /regular-question/ask 相同量级的限流，避免匿名/自动化批量灌入复核池。
  const limited = await rateLimit(request, "regular-question-review", 40);
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

    // 强制要求有效 JWT：requesterId 必须从 token 解析得来，
    // 不允许仅靠 body 里的 requesterId/Name 就创建复核任务。
    if (!payload.requesterId) {
      return NextResponse.json(
        { ok: false, message: "请先登录后再发起人工复核。" },
        { status: 401 },
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
