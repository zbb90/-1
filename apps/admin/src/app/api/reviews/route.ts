import { NextRequest, NextResponse } from "next/server";
import { getReviewReadScope } from "@/lib/review-access";
import { listReviewTasks } from "@/lib/review-pool";

export async function GET(request: NextRequest) {
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

    const tasks = await listReviewTasks({
      requesterId: scope.requesterId,
    });
    return NextResponse.json({
      ok: true,
      data: tasks,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "读取复核池列表时发生异常",
      },
      { status: 500 },
    );
  }
}
