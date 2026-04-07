import { NextResponse } from "next/server";
import { getKnowledgeSummary } from "@/lib/knowledge-base";

export async function GET() {
  try {
    const summary = await getKnowledgeSummary();
    return NextResponse.json({
      ok: true,
      data: summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "读取知识库摘要时发生异常",
      },
      { status: 500 },
    );
  }
}
