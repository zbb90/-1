import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import {
  getKnowledgeTagIndex,
  listEntriesByTag,
  listKnowledgeTags,
} from "@/lib/knowledge-tags";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  try {
    const tag = request.nextUrl.searchParams.get("tag")?.trim() || "";
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";

    if (refresh) {
      await getKnowledgeTagIndex({ forceRebuild: true });
    }

    const [tags, entries] = await Promise.all([
      listKnowledgeTags(),
      tag ? listEntriesByTag(tag) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      ok: true,
      data: {
        tags: tags.map((item) => ({ tag: item.tag, count: item.count })),
        entries,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "读取标签失败" },
      { status: 500 },
    );
  }
}
