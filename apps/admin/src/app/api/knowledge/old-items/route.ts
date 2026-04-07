import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { appendRow, patchRowStatus, readTable } from "@/lib/knowledge-csv";

export async function GET() {
  try {
    const rows = await readTable("old-items");
    return NextResponse.json({ ok: true, data: rows });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "读取失败",
      },
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
    const row = await appendRow("old-items", body as Record<string, string>);
    return NextResponse.json({ ok: true, data: row }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "写入失败",
      },
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
    const updated = await patchRowStatus("old-items", body.id, body.status);
    if (!updated)
      return NextResponse.json(
        { ok: false, message: "未找到条目。" },
        { status: 404 },
      );
    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "更新失败",
      },
      { status: 500 },
    );
  }
}
