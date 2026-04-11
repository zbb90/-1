import type { ReactNode } from "react";

/**
 * 统一页头：副标题、主标题、说明与右侧操作区。
 */
export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
  footer,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200 md:rounded-3xl md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-green-700 md:text-sm">{eyebrow}</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-gray-900 md:mt-2 md:text-3xl">
            {title}
          </h1>
          {description ? (
            <div className="mt-2 text-xs leading-5 text-gray-600 md:mt-3 md:text-sm md:leading-6">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {footer ? <div className="mt-4 md:mt-6">{footer}</div> : null}
    </section>
  );
}
