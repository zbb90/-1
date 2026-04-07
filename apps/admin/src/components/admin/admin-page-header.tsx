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
    <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-gray-200 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-green-700">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
            {title}
          </h1>
          {description ? (
            <div className="mt-3 text-sm leading-6 text-gray-600">{description}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {footer ? <div className="mt-6">{footer}</div> : null}
    </section>
  );
}
