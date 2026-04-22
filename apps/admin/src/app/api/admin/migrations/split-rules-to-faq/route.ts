import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import {
  applySplitMigration,
  planSplitMigration,
} from "@/lib/migrations/split-rules-to-faq-online";

async function requireLeader() {
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  return session?.role === "leader";
}

export async function GET() {
  if (!(await requireLeader())) {
    return NextResponse.json({ ok: false, message: "需要领导身份。" }, { status: 401 });
  }
  try {
    const plan = await planSplitMigration();
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "预览失败",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireLeader())) {
    return NextResponse.json({ ok: false, message: "需要领导身份。" }, { status: 401 });
  }
  let payload: { confirm?: boolean } = {};
  try {
    payload = (await request.json().catch(() => ({}))) as { confirm?: boolean };
  } catch {
    payload = {};
  }
  if (payload.confirm !== true) {
    return NextResponse.json(
      {
        ok: false,
        message: "缺少 confirm:true，拒绝执行写入。",
      },
      { status: 400 },
    );
  }

  try {
    const result = await applySplitMigration();
    return NextResponse.json({
      ok: true,
      message: `迁移完成：FAQ ${result.faqTotal} → ${result.faqAfter}（新增 ${result.insertedFaqIds.length}），rules ${result.rulesTotal} → ${result.rulesAfter}（移除 ${result.removedRuleIds.length}）。`,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "迁移失败",
      },
      { status: 500 },
    );
  }
}
