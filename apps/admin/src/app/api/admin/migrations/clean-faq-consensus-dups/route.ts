import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import {
  applyFaqCleanDups,
  planFaqCleanDups,
} from "@/lib/migrations/clean-faq-consensus-dups-online";

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
    const plan = await planFaqCleanDups();
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
      { ok: false, message: "缺少 confirm:true，拒绝执行写入。" },
      { status: 400 },
    );
  }

  try {
    const result = await applyFaqCleanDups();
    return NextResponse.json({
      ok: true,
      message: `FAQ 清理完成：${result.faqTotal} → ${result.faqAfter}（删除 ${result.deletedFaqIds.length} 条共识冗余；保留 ${result.retained} 条真答疑沉淀；${result.orphans} 条孤儿待人工）。`,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "清理失败",
      },
      { status: 500 },
    );
  }
}
