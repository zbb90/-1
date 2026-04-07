import Link from "next/link";
import { cookies } from "next/headers";
import { getReviewSummary } from "@/lib/review-pool";
import { listAllUsers } from "@/lib/user-store";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function HomePage() {
  const reviewSummary = await getReviewSummary();
  const cookieStore = await cookies();
  const role = cookieStore.get("audit_role")?.value;
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

  return (
    <AdminShell>
      {role ? (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm ring-1 ring-gray-200/80 md:px-5">
          <AdminNav current="home" showUsersLink={isLeader} />
        </div>
      ) : null}

      <section className="rounded-3xl bg-gradient-to-br from-green-700 to-green-900 p-8 text-white shadow-lg">
        <p className="text-sm font-medium text-green-200">稽核 AI 助手</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">管理工作台</h1>
        <p className="mt-2 text-sm leading-6 text-green-100">
          {isLeader
            ? "您已以负责人身份登录，可管理复核、知识库与全部账号。"
            : role === "supervisor"
              ? "您已以主管身份登录，可处理复核任务与管理知识库。"
              : "请先登录后使用管理功能。"}
        </p>
        {!role && (
          <Link
            href="/reviews/login"
            className="mt-4 inline-block rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-green-800 shadow transition hover:bg-green-50"
          >
            登录
          </Link>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200"
          >
            <p className="text-xs font-medium text-gray-500">{s.label}</p>
            <p className={`mt-2 text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </section>

      {isLeader && (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <p className="text-xs font-medium text-gray-500">主管人数</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">
              {userCounts.supervisor}
            </p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <p className="text-xs font-medium text-gray-500">专员人数</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">
              {userCounts.specialist}
            </p>
          </div>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {navItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="group flex items-start gap-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 transition hover:shadow-md hover:ring-green-200"
          >
            <span className="text-2xl">{item.icon}</span>
            <div>
              <p className="text-sm font-semibold text-gray-900 group-hover:text-green-700">
                {item.label}
              </p>
              <p className="mt-1 text-xs text-gray-500">{item.desc}</p>
            </div>
          </Link>
        ))}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">最新复核任务</h2>
          <Link
            href="/reviews"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
          >
            查看全部
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {reviewSummary.latest.length === 0 ? (
            <p className="text-sm text-gray-400">
              暂无复核任务，专员在小程序提问后会自动产生。
            </p>
          ) : (
            reviewSummary.latest.map((r) => (
              <Link
                key={r.id}
                href={`/reviews/${r.id}`}
                className="flex items-center justify-between rounded-xl border border-gray-200 p-4 transition hover:bg-gray-50"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{r.description}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {r.category} · {r.id}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                    r.status === "待处理"
                      ? "bg-amber-50 text-amber-700"
                      : r.status === "已处理"
                        ? "bg-green-50 text-green-700"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {r.status}
                </span>
              </Link>
            ))
          )}
        </div>
      </section>
    </AdminShell>
  );
}
