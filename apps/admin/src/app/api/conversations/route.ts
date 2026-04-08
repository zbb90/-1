import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { getRequesterIdFromRequest } from "@/lib/requester";
import { getReviewTaskById, updateReviewTask } from "@/lib/review-pool";

/**
 * PATCH /api/conversations
 * 两种调用方：
 *   1. 主管（Basic Auth / session cookie）：直接标记任意任务答错，转为"待处理"
 *   2. 专员（Bearer JWT）：仅限标记自己的任务，表示对 AI 答案有异议
 */
export async function PATCH(request: NextRequest) {
  const isAdmin = await isAdminSessionOrBasicAuthorized(request);
  const requesterId = await getRequesterIdFromRequest(request);

  if (!isAdmin && !requesterId) {
    return NextResponse.json(
      { ok: false, message: "需要身份验证（主管登录或小程序登录态）。" },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as { taskId: string };
    if (!body.taskId?.trim()) {
      return NextResponse.json(
        { ok: false, message: "缺少 taskId。" },
        { status: 400 },
      );
    }

    const task = await getReviewTaskById(body.taskId);
    if (!task) {
      return NextResponse.json(
        { ok: false, message: "未找到对应任务。" },
        { status: 404 },
      );
    }

    // 专员只能操作属于自己的任务
    if (!isAdmin && requesterId && task.requesterId !== requesterId) {
      return NextResponse.json(
        { ok: false, message: "无权操作他人的任务。" },
        { status: 403 },
      );
    }

    const rejectReason = isAdmin
      ? "主管标记 AI 回答有误，转人工复核。"
      : "专员对 AI 自动回答有异议，申请人工复核。";

    const updated = await updateReviewTask(body.taskId, {
      status: "待处理",
      rejectReason,
    });

    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "操作失败",
      },
      { status: 500 },
    );
  }
}
