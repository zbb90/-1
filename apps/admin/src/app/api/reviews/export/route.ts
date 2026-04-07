import { NextRequest, NextResponse } from "next/server";
import { getReviewReadScope } from "@/lib/review-access";
import { listReviewTasks } from "@/lib/review-pool";
import type { ReviewTask } from "@/lib/types";

function escapeCsvValue(value?: string) {
  const normalized = (value ?? "").replace(/"/g, '""');
  return `"${normalized}"`;
}

function toCsv(tasks: ReviewTask[]) {
  const headers = [
    "任务编号",
    "任务类型",
    "任务状态",
    "创建时间",
    "更新时间",
    "门店编码",
    "问题分类",
    "提问人",
    "问题描述",
    "系统拒答原因",
    "最终结论",
    "最终分值",
    "最终依据条款",
    "最终解释",
    "处理人",
  ];

  const rows = tasks.map((task) =>
    [
      task.id,
      task.type,
      task.status,
      task.createdAt,
      task.updatedAt,
      task.storeCode,
      task.category,
      task.requester,
      task.description,
      task.rejectReason,
      task.finalConclusion,
      task.finalScore,
      task.finalClause,
      task.finalExplanation,
      task.processor,
    ]
      .map((value) => escapeCsvValue(value))
      .join(","),
  );

  return `\uFEFF${[headers.join(","), ...rows].join("\n")}`;
}

export async function GET(request: NextRequest) {
  try {
    const scope = await getReviewReadScope(request);
    if (scope.kind !== "admin") {
      return NextResponse.json(
        {
          ok: false,
          message: "只有主管后台可以导出复核结论。",
        },
        { status: 401 },
      );
    }

    const format = request.nextUrl.searchParams.get("format")?.trim() || "csv";
    const tasks = await listReviewTasks({
      requesterId: scope.requesterId,
    });
    const exportTasks = tasks.filter(
      (task) =>
        task.status === "已处理" ||
        task.status === "已加入知识库" ||
        Boolean(task.finalConclusion || task.finalExplanation),
    );

    if (format === "json") {
      return NextResponse.json({
        ok: true,
        data: exportTasks,
      });
    }

    return new NextResponse(toCsv(exportTasks), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="review-knowledge-export.csv"',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "导出复核结论时发生异常",
      },
      { status: 500 },
    );
  }
}
