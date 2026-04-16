import Link from "next/link";
import { cookies } from "next/headers";
import { getReviewSummary } from "@/lib/review-pool";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { listAllUsers } from "@/lib/user-store";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  StatusPill,
  WorkspaceActionLink,
  WorkspaceEmptyState,
  WorkspaceMetric,
  WorkspaceSection,
} from "@/components/admin/knowledge-workspace";

export default async function HomePage() {
  let reviewSummary = {
    total: 0,
    pending: 0,
    needMoreInfo: 0,
    completed: 0,
    latest: [],
  } as Awaited<ReturnType<typeof getReviewSummary>>;
  try {
    reviewSummary = await getReviewSummary();
  } catch {
    // 复核数据异常时不要让工作台整页 500，先降级展示空态。
  }
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  const role = session?.role;
  const isLeader = role === "leader";

  let userCounts = { supervisor: 0, specialist: 0 };
  if (isLeader) {
    try {
      const users = await listAllUsers();
      userCounts = {
        supervisor: users.filter((u) => u.role === "supervisor").length,
        specialist: users.filter((u) => u.role === "specialist").length,
      };
    } catch {
      // Redis 不可用时降级
    }
  }

  const stats = [
    { label: "复核总数", value: reviewSummary.total, color: "text-gray-900" },
    { label: "待复核", value: reviewSummary.pending, color: "text-amber-600" },
    { label: "待补充", value: reviewSummary.needMoreInfo, color: "text-orange-600" },
    { label: "已处理", value: reviewSummary.completed, color: "text-green-700" },
  ];

  const navItems = [
    { href: "/reviews", label: "复核池", desc: "查看并处理待复核任务", icon: "📋" },
    { href: "/conversations", label: "问答日志", desc: "查看全部问答记录", icon: "💬" },
    { href: "/knowledge", label: "知识库", desc: "管理稽核规则数据", icon: "📚" },
    {
      href: "/knowledge/audit-match",
      label: "稽核共识匹配",
      desc: "上传 Excel 自动匹配条款与共识",
      icon: "🧠",
    },
    ...(isLeader
      ? [
          {
            href: "/users",
            label: "账号管理",
            desc: "管理主管与专员账号",
            icon: "👥",
          },
        ]
      : []),
    {
      href: "/api/reviews/export?format=csv",
      label: "导出结论",
      desc: "下载 CSV 格式复核报告",
      icon: "📥",
    },
  ];

  const latestTasks = reviewSummary.latest.map((task) => ({
    id: String(task?.id ?? "-"),
    description: String(task?.description ?? "-"),
    category: String(task?.category ?? "-"),
    status: String(task?.status ?? "-"),
  }));

  return (
    <AdminShell>
      <AdminPageHeader
        eyebrow="稽核 AI 助手"
        title="管理工作台"
        description={
          isLeader
            ? "您已以负责人身份登录，可统一管理复核、知识库、问答日志与全部账号。"
            : role === "supervisor"
              ? "您已以主管身份登录，可处理复核任务、查看问答日志并维护知识库。"
              : "请先登录后使用管理功能。"
        }
        actions={
          role ? (
            <AdminNav current="home" showUsersLink={isLeader} showStorageLink={isLeader} />
          ) : (
            <WorkspaceActionLink href="/reviews/login" tone="green">
              登录
            </WorkspaceActionLink>
          )
        }
      />

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <WorkspaceMetric key={s.label} label={s.label} value={s.value} />
        ))}
      </section>

      {isLeader && (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-2">
          <WorkspaceMetric label="主管人数" value={userCounts.supervisor} tone="blue" />
          <WorkspaceMetric label="专员人数" value={userCounts.specialist} tone="violet" />
        </section>
      )}

      <WorkspaceSection
        title="工作入口"
        description="统一按知识库工作台样式组织常用入口。"
      >
        <div className="grid gap-4 md:grid-cols-3">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="group flex items-start gap-4 rounded-2xl border border-gray-100 bg-slate-50/70 p-5 transition hover:border-green-200 hover:bg-green-50/60"
            >
              <span className="text-2xl">{item.icon}</span>
              <div>
                <p className="text-sm font-semibold text-gray-900 group-hover:text-green-700">
                  {item.label}
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500">{item.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </WorkspaceSection>

      <WorkspaceSection
        title="最新复核任务"
        description="保持与小程序“我的复核”一致的最新处理列表。"
        actions={
          <WorkspaceActionLink href="/reviews" tone="slate" outline>
            查看全部
          </WorkspaceActionLink>
        }
      >
        <div className="space-y-3">
          {latestTasks.length === 0 ? (
            <WorkspaceEmptyState
              title="暂无复核任务"
              description="专员在小程序提问后，系统会自动生成复核任务并出现在这里。"
            />
          ) : (
            latestTasks.map((r) => (
              <Link
                key={r.id}
                href={`/reviews/${r.id}`}
                className="flex items-center justify-between rounded-2xl border border-gray-100 bg-slate-50/70 p-4 transition hover:border-green-200 hover:bg-green-50/60"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{r.description}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {r.category} · {r.id}
                  </p>
                </div>
                <StatusPill
                  tone={
                    r.status === "待处理"
                      ? "amber"
                      : r.status === "已处理"
                        ? "green"
                        : "slate"
                  }
                >
                  {r.status}
                </StatusPill>
              </Link>
            ))
          )}
        </div>
      </WorkspaceSection>
    </AdminShell>
  );
}
