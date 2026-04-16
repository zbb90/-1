import Link from "next/link";
import type { ReactNode } from "react";
import { adminLogoutAction } from "@/app/reviews/actions";
import { TaskNotifier } from "@/components/admin/task-notifier";

export type AdminNavKey =
  | "home"
  | "reviews"
  | "conversations"
  | "knowledge"
  | "users"
  | "storage";

const navItem = (active: boolean) =>
  active
    ? "rounded-xl bg-green-700 px-4 py-2 text-sm font-medium text-white shadow-sm"
    : "rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50";

/**
 * 桌面端顶栏导航 + 移动端底部固定 Tab 栏。
 */
export function AdminNav({
  current,
  showUsersLink = false,
  showStorageLink = false,
  extraActions,
}: {
  current: AdminNavKey | null;
  showUsersLink?: boolean;
  showStorageLink?: boolean;
  extraActions?: ReactNode;
}) {
  return (
    <>
      {/* Desktop nav (hidden on mobile) */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <Link href="/" className={navItem(current === "home")}>
          工作台
        </Link>
        <Link
          href="/reviews"
          className={`${navItem(current === "reviews")} inline-flex items-center gap-1.5`}
        >
          复核池 <TaskNotifier />
        </Link>
        <Link href="/conversations" className={navItem(current === "conversations")}>
          问答日志
        </Link>
        <Link href="/knowledge" className={navItem(current === "knowledge")}>
          知识库
        </Link>
        {showUsersLink ? (
          <Link href="/users" className={navItem(current === "users")}>
            账号管理
          </Link>
        ) : null}
        {showStorageLink ? (
          <Link href="/storage" className={navItem(current === "storage")}>
            存储诊断
          </Link>
        ) : null}
        {extraActions}
        <form action={adminLogoutAction}>
          <button
            type="submit"
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50"
          >
            退出登录
          </button>
        </form>
      </div>

      {/* Mobile bottom tab bar (shown on small screens only) */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <MobileTab href="/" label="工作台" icon="🏠" active={current === "home"} />
        <MobileTab
          href="/reviews"
          label="复核池"
          icon="📋"
          active={current === "reviews"}
          badge={<TaskNotifier />}
        />
        <MobileTab
          href="/conversations"
          label="日志"
          icon="💬"
          active={current === "conversations"}
        />
        <MobileTab
          href="/knowledge"
          label="知识库"
          icon="📚"
          active={current === "knowledge"}
        />
      </nav>
    </>
  );
}

function MobileTab({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition ${
        active ? "font-semibold text-green-700" : "text-gray-500"
      }`}
    >
      <span className="relative text-lg">
        {icon}
        {badge ? <span className="absolute -right-3 -top-1">{badge}</span> : null}
      </span>
      {label}
    </Link>
  );
}
