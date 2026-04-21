import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { logRouteError, readJsonBody } from "@/lib/api-utils";
import {
  generateLinkSuggestions,
  isLinkSuggestionsEnabled,
} from "@/lib/link-suggester";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type TriggerBody = {
  dryRun?: boolean;
  maxPairs?: number;
  topKPerEntry?: number;
  minVectorSimilarity?: number;
  minAcceptConfidence?: number;
};

export async function POST(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  // 扫描会打 LLM，严格限流：每分钟 6 次足够管理员操作。
  const limited = await rateLimit(request, "knowledge-link-suggest", 6);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, message: "扫描请求过于频繁，请稍后再试。" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  if (!isLinkSuggestionsEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        message: "AI 关联建议功能未启用。请先设置 KB_LINK_SUGGESTIONS_ENABLED=1。",
      },
      { status: 400 },
    );
  }

  try {
    const body = (await readJsonBody(request)) as TriggerBody | null;
    const result = await generateLinkSuggestions({
      dryRun: Boolean(body?.dryRun),
      maxPairs: body?.maxPairs,
      topKPerEntry: body?.topKPerEntry,
      minVectorSimilarity: body?.minVectorSimilarity,
      minAcceptConfidence: body?.minAcceptConfidence,
    });
    return NextResponse.json({ ok: result.ok, data: result });
  } catch (error) {
    logRouteError("/api/knowledge/links/suggest", error);
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "生成关联建议失败",
      },
      { status: 500 },
    );
  }
}
