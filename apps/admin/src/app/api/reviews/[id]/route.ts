import { NextRequest, NextResponse } from "next/server";
import { getReviewReadScope } from "@/lib/review-access";
import {
  getReviewTaskById,
  markReviewTaskRequesterRead,
  updateReviewTask,
} from "@/lib/review-pool";
import type { ReviewTaskStatus } from "@/lib/types";

function resolveFinalTaskStatus(params: {
  status?: ReviewTaskStatus;
  finalConclusion?: string;
  finalExplanation?: string;
}) {
  const status = params.status;
  if (!status) {
    return undefined;
  }

  const hasManualReply =
    Boolean(params.finalConclusion?.trim()) || Boolean(params.finalExplanation?.trim());

  if (hasManualReply && (status === "待处理" || status === "AI已自动回答")) {
    return "已处理" as const;
  }

  return status;
}

function buildRequesterReplyPatch(body: {
  status?: ReviewTaskStatus;
  finalConclusion?: string;
  finalExplanation?: string;
}) {
  const resolvedStatus = resolveFinalTaskStatus(body);
  const shouldNotifyRequester =
    resolvedStatus === "已处理" ||
    resolvedStatus === "已加入知识库" ||
    resolvedStatus === "待补充" ||
    Boolean(body.finalConclusion?.trim()) ||
    Boolean(body.finalExplanation?.trim());

  if (!shouldNotifyRequester) {
    return {};
  }

  return {
    replyPublishedAt: new Date().toISOString(),
    status: resolvedStatus,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = await getReviewReadScope(request);
    if (scope.kind === "unauthorized") {
      return NextResponse.json(
        {
          ok: false,
          message: scope.message,
        },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    const task = await getReviewTaskById(id, {
      requesterId: scope.requesterId,
    });

    if (!task) {
      return NextResponse.json(
        {
          ok: false,
          message: "未找到对应复核任务",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      data: task,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "读取复核任务详情时发生异常",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = await getReviewReadScope(request);
    if (scope.kind === "unauthorized") {
      return NextResponse.json(
        {
          ok: false,
          message: scope.message,
        },
        { status: 401 },
      );
    }

    const body = (await request.json()) as {
      status?: ReviewTaskStatus;
      processor?: string;
      finalConclusion?: string;
      finalScore?: string;
      finalClause?: string;
      finalExplanation?: string;
      markRequesterRead?: boolean;
    };
    const { id } = await context.params;

    const task = await getReviewTaskById(id, {
      requesterId: scope.kind === "requester" ? scope.requesterId : undefined,
    });
    if (!task) {
      return NextResponse.json(
        {
          ok: false,
          message: "未找到对应复核任务",
        },
        { status: 404 },
      );
    }

    if (scope.kind === "requester") {
      if (!body.markRequesterRead) {
        return NextResponse.json(
          {
            ok: false,
            message: "仅支持标记已读。",
          },
          { status: 403 },
        );
      }

      const updated = await markReviewTaskRequesterRead(id);
      return NextResponse.json({
        ok: true,
        data: updated,
      });
    }

    const updated = await updateReviewTask(id, {
      ...body,
      status: resolveFinalTaskStatus(body),
      ...buildRequesterReplyPatch(body),
    });
    if (!updated) {
      return NextResponse.json(
        {
          ok: false,
          message: "未找到对应复核任务",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      data: updated,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "更新复核任务时发生异常",
      },
      { status: 500 },
    );
  }
}
