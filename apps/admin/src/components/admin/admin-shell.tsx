import type { ReactNode } from "react";

/**
 * 统一页面容器：桌面与移动端均可使用。
 * 移动端底部预留固定 Tab 栏空间。
 */
export function AdminShell({
  children,
  maxWidthClass = "max-w-6xl",
}: {
  children: ReactNode;
  maxWidthClass?: "max-w-6xl" | "max-w-5xl";
}) {
  return (
    <main className="min-h-screen bg-gray-50">
      <div
        className={`mx-auto space-y-6 px-4 py-6 pb-24 md:space-y-8 md:px-8 md:py-8 md:pb-8 ${maxWidthClass}`}
      >
        {children}
      </div>
    </main>
  );
}
