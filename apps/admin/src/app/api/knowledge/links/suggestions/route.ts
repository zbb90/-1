import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { logRouteError } from "@/lib/api-utils";
import {
  countSuggestionsByStatus,
  listSuggestions,
  type LinkSuggestionStatus,
} from "@/lib/knowledge-link-suggestions";

export const dynamic = "force-dynamic";

const VALID_STATUS: Array<LinkSuggestionStatus | "all"> = [
  "pending",
  "approved",
  "rejected",
  "skipped",
  "all",
];

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function GET(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  try {
    const sp = request.nextUrl.searchParams;
    const rawStatus = sp.get("status")?.trim() as LinkSuggestionStatus | "all" | null;
    const status =
      rawStatus && VALID_STATUS.includes(rawStatus) ? rawStatus : "pending";
    const limit = clampInt(sp.get("limit"), 50, 1, 500);
    const offset = clampInt(sp.get("offset"), 0, 0, 10000);
    const [{ items, total }, stats] = await Promise.all([
      listSuggestions({ status, limit, offset }),
      countSuggestionsByStatus(),
    ]);
    return NextResponse.json({
      ok: true,
      data: { items, total, stats, status, limit, offset },
    });
  } catch (error) {
    logRouteError("/api/knowledge/links/suggestions", error);
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "读取关联建议失败",
      },
      { status: 500 },
    );
  }
}
