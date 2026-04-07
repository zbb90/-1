import Link from "next/link";
import type { ReactNode } from "react";
import { adminLogoutAction } from "@/app/reviews/actions";

export type AdminNavKey = "home" | "reviews" | "conversations" | "knowledge" | "users";

const navItem = (active: boolean) =>
  active
    ? "rounded-xl bg-green-700 px-4 py-2 text-sm font-medium text-white shadow-sm"
    : "rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50";

/**
 * 全局主导航：各页高亮当前项；负责人可见「账号管理」。
 */
export function AdminNav({
  current,
  showUsersLink = false,
  extraActions,
}: {
  current: AdminNavKey | null;
  showUsersLink?: boolean;
  extraActions?: ReactNode;
}) {
  return (
    <>
      <Link href="/" className={navItem(current === "home")}>
        工作台
      </Link>
      <Link href="/reviews" className={navItem(current === "reviews")}>
        复核池
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
      {extraActions}
      <form action={adminLogoutAction}>
        <button
          type="submit"
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50"
        >
          退出登录
        </button>
      </form>
    </>
  );
}
