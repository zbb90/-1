import { NextResponse } from "next/server";
import { listReviewTasks } from "@/lib/review-pool";

export const dynamic = "force-dynamic";

export async function GET() {
  const tasks = await listReviewTasks();
  const pending = tasks.filter(
    (t) => t.status === "待处理" || t.status === "AI已自动回答",
  );
  return NextResponse.json({ count: pending.length });
}
