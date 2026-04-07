import { NextRequest, NextResponse } from "next/server";
import { getReviewReadScope } from "@/lib/review-access";
import { getReviewTaskById, updateReviewTask } from "@/lib/review-pool";
import type { ReviewTaskStatus } from "@/lib/types";

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
    const body = (await request.json()) as {
      status?: ReviewTaskStatus;
      processor?: string;
      finalConclusion?: string;
      finalScore?: string;
      finalClause?: string;
      finalExplanation?: string;
    };
    const { id } = await context.params;

    const updated = await updateReviewTask(id, body);
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
