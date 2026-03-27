import { NextRequest, NextResponse } from "next/server";
import { getRequesterIdFromRequest } from "@/lib/requester";
import { listReviewTasks } from "@/lib/review-pool";

export async function GET(request: NextRequest) {
  try {
    const tasks = await listReviewTasks({
      requesterId: getRequesterIdFromRequest(request),
    });
    return NextResponse.json({
      ok: true,
      data: tasks,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "读取复核池列表时发生异常",
      },
      { status: 500 },
    );
  }
}
