import { NextRequest, NextResponse } from "next/server";
import {
  getAdminSessionFromRequest,
  isAdminSessionOrBasicAuthorized,
} from "@/lib/admin-session";
import { logRouteError, readJsonBody } from "@/lib/api-utils";
import { addKnowledgeLink } from "@/lib/knowledge-links";
import {
  addPairToBlocklist,
  getSuggestionById,
  updateSuggestionStatus,
} from "@/lib/knowledge-link-suggestions";

export const dynamic = "force-dynamic";

type ActionBody = { action?: "approve" | "reject" | "skip" };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  try {
    const { id } = await params;
    const body = (await readJsonBody(request)) as ActionBody | null;
    const action = body?.action;
    if (!action || !["approve", "reject", "skip"].includes(action)) {
      return NextResponse.json(
        { ok: false, message: "action 必须是 approve / reject / skip。" },
        { status: 400 },
      );
    }

    const suggestion = await getSuggestionById(id);
    if (!suggestion) {
      return NextResponse.json(
        { ok: false, message: "建议不存在或已被清理。" },
        { status: 404 },
      );
    }
    if (suggestion.status !== "pending") {
      return NextResponse.json(
        {
          ok: false,
          message: `该建议已处于 ${suggestion.status} 状态，无法重复操作。`,
        },
        { status: 409 },
      );
    }

    const session = await getAdminSessionFromRequest(request);
    const operator =
      session?.name?.trim() ||
      session?.sub?.trim() ||
      request.headers.get("x-admin-user") ||
      "admin";

    if (action === "approve") {
      const link = await addKnowledgeLink({
        sourceTable: suggestion.sourceTable,
        sourceId: suggestion.sourceId,
        targetTable: suggestion.targetTable,
        targetId: suggestion.targetId,
        linkType: suggestion.linkType,
        origin: "ai",
        aiConfidence: suggestion.confidence,
        aiReason: suggestion.reason,
      });
      const updated = await updateSuggestionStatus(id, {
        status: "approved",
        decidedBy: operator,
        appliedLinkId: link?.id,
      });
      return NextResponse.json({ ok: true, data: { suggestion: updated, link } });
    }

    if (action === "reject") {
      await addPairToBlocklist(
        { table: suggestion.sourceTable, id: suggestion.sourceId },
        { table: suggestion.targetTable, id: suggestion.targetId },
      );
      const updated = await updateSuggestionStatus(id, {
        status: "rejected",
        decidedBy: operator,
      });
      return NextResponse.json({ ok: true, data: { suggestion: updated } });
    }

    // skip
    const updated = await updateSuggestionStatus(id, {
      status: "skipped",
      decidedBy: operator,
    });
    return NextResponse.json({ ok: true, data: { suggestion: updated } });
  } catch (error) {
    logRouteError("/api/knowledge/links/suggestions/:id", error);
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "处理关联建议失败",
      },
      { status: 500 },
    );
  }
}
