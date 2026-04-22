import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import type { KbTableName } from "@/lib/kb-schema";
import {
  addKnowledgeLink,
  getKnowledgeLinksForEntry,
  removeKnowledgeLink,
} from "@/lib/knowledge-links";

export const dynamic = "force-dynamic";

const TABLES: KbTableName[] = [
  "rules",
  "consensus",
  "external-purchases",
  "old-items",
  "operations",
  "faq",
];

function isKbTableName(value: string | null): value is KbTableName {
  return Boolean(value && TABLES.includes(value as KbTableName));
}

export async function GET(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  const table = request.nextUrl.searchParams.get("table");
  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!isKbTableName(table) || !id) {
    return NextResponse.json(
      { ok: false, message: "缺少有效的 table 或 id 参数。" },
      { status: 400 },
    );
  }

  try {
    const data = await getKnowledgeLinksForEntry(table, id);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "读取关联失败" },
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
    const body = (await request.json()) as {
      sourceTable: KbTableName;
      sourceId: string;
      targetTable: KbTableName;
      targetId: string;
      linkType: "references" | "supports" | "related" | "supersedes" | "contradicts";
    };
    if (!isKbTableName(body.sourceTable) || !isKbTableName(body.targetTable)) {
      return NextResponse.json(
        { ok: false, message: "知识表类型无效。" },
        { status: 400 },
      );
    }

    const link = await addKnowledgeLink(body);
    return NextResponse.json({ ok: true, data: link }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "创建关联失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAdminSessionOrBasicAuthorized(request))) {
    return NextResponse.json(
      { ok: false, message: "需要管理员身份。" },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as { id?: string };
    const id = body.id?.trim();
    if (!id) {
      return NextResponse.json(
        { ok: false, message: "缺少关联 ID。" },
        { status: 400 },
      );
    }

    const removed = await removeKnowledgeLink(id);
    if (!removed) {
      return NextResponse.json(
        { ok: false, message: "未找到可删除的手动关联。" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "删除关联失败" },
      { status: 500 },
    );
  }
}
