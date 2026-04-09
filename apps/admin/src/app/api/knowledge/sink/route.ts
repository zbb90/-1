import { NextRequest, NextResponse } from "next/server";
import { formatZodError, logRouteError, readJsonBody } from "@/lib/api-utils";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { KnowledgeSinkError, sinkReviewTaskToKnowledge } from "@/lib/knowledge-sink";
import { knowledgeSinkBodySchema } from "@/lib/schemas";

/**
 * POST /api/knowledge/sink
 * 主管确认后，将复核任务的最终结论沉淀到统一知识存储（Redis / CSV fallback），
 * 并在常规问题表中同步向量索引。仅当知识写入成功后，才更新任务状态为「已加入知识库」。
 */
export async function POST(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份验证。" },
      { status: 401 },
    );
  }

  try {
    const parsed = knowledgeSinkBodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, message: formatZodError(parsed.error) },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const result = await sinkReviewTaskToKnowledge(body.taskId);
    const vectorStatus =
      result.audit.vectorSync === "synced"
        ? "已同步向量索引"
        : `向量同步跳过：${result.audit.vectorSyncReason || "未配置"}`;

    return NextResponse.json({
      ok: true,
      message: `已成功写入 ${result.audit.table}，新条目 ID：${result.audit.newId}，${vectorStatus}`,
      data: result.audit,
    });
  } catch (error) {
    if (error instanceof KnowledgeSinkError) {
      return NextResponse.json(
        {
          ok: false,
          message: error.message,
        },
        { status: error.status },
      );
    }
    logRouteError("/api/knowledge/sink", error);
    return NextResponse.json(
      {
        ok: false,
        message: "知识沉淀操作失败，请稍后重试。",
      },
      { status: 500 },
    );
  }
}
