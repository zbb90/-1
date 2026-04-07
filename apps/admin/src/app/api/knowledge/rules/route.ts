import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { readRows, appendRow, patchRowStatus, updateRow } from "@/lib/knowledge-store";
import { upsertRuleVectors } from "@/lib/vector-store";
import type { RuleRow } from "@/lib/types";

export async function GET() {
  try {
    const rows = await readRows("rules");
    return NextResponse.json({ ok: true, data: rows });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "读取失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }
  try {
    const body = await request.json();
    const row = await appendRow("rules", body as Record<string, string>);
    const syncResult = await upsertRuleVectors([row as unknown as RuleRow]);
    if (!syncResult.ok) {
      console.warn("rule vector sync skipped after POST", syncResult.reason);
    }
    return NextResponse.json({ ok: true, data: row }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "写入失败" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }
  try {
    const body = (await request.json()) as { id: string; data: Record<string, string> };
    const updated = await updateRow("rules", body.id, body.data);
    if (!updated)
      return NextResponse.json({ ok: false, message: "未找到条目。" }, { status: 404 });
    const syncResult = await upsertRuleVectors([updated as unknown as RuleRow]);
    if (!syncResult.ok) {
      console.warn("rule vector sync skipped after PUT", syncResult.reason);
    }
    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "更新失败" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }
  try {
    const body = (await request.json()) as { id: string; status: string };
    const updated = await patchRowStatus("rules", body.id, body.status);
    if (!updated)
      return NextResponse.json({ ok: false, message: "未找到条目。" }, { status: 404 });
    const syncResult = await upsertRuleVectors([updated as unknown as RuleRow]);
    if (!syncResult.ok) {
      console.warn("rule vector sync skipped after PATCH", syncResult.reason);
    }
    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "更新失败" },
      { status: 500 },
    );
  }
}
