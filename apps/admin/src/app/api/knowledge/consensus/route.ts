import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { readRows, appendRow, patchRowStatus, updateRow } from "@/lib/knowledge-store";
import { upsertConsensusVectors } from "@/lib/vector-store";
import type { ConsensusRow } from "@/lib/types";

async function syncConsensusVector(row: unknown, op: string) {
  try {
    const result = await upsertConsensusVectors([row as ConsensusRow]);
    if (!result.ok) {
      console.warn(`[consensus][${op}] vector sync skipped`, result.reason);
    }
  } catch (error) {
    console.warn(`[consensus][${op}] vector sync failed`, error);
  }
}

export async function GET() {
  try {
    const rows = await readRows("consensus");
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
    const row = await appendRow("consensus", body as Record<string, string>);
    await syncConsensusVector(row, "POST");
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
    const updated = await updateRow("consensus", body.id, body.data);
    if (!updated)
      return NextResponse.json({ ok: false, message: "未找到条目。" }, { status: 404 });
    await syncConsensusVector(updated, "PUT");
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
    const updated = await patchRowStatus("consensus", body.id, body.status);
    if (!updated)
      return NextResponse.json({ ok: false, message: "未找到条目。" }, { status: 404 });
    await syncConsensusVector(updated, "PATCH");
    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "更新失败" },
      { status: 500 },
    );
  }
}
