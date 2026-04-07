import type { ReactNode } from "react";

/**
 * PC 端后台统一页面容器：背景、最大宽度、内边距与纵向节奏一致。
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
        className={`mx-auto space-y-6 px-4 py-6 md:space-y-8 md:px-8 md:py-8 ${maxWidthClass}`}
      >
        {children}
      </div>
    </main>
  );
}
