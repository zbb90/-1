import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function WorkspaceSection({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          {description ? (
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function WorkspaceMetric({
  label,
  value,
  meta,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  meta?: string;
  tone?: "slate" | "green" | "amber" | "blue" | "violet" | "red";
}) {
  const toneClass = {
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
    green: "bg-green-50 text-green-700 ring-green-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
    red: "bg-red-50 text-red-700 ring-red-200",
  }[tone];

  return (
    <div className={`rounded-2xl px-4 py-3 ring-1 ${toneClass}`}>
      <p className="text-xs font-medium tracking-wide opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {meta ? <p className="mt-1 text-xs opacity-80">{meta}</p> : null}
    </div>
  );
}

export function WorkspacePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-slate-900 text-white"
          : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "slate" | "green" | "amber" | "red" | "blue";
  children: ReactNode;
}) {
  const toneClass = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    green: "bg-green-50 text-green-700 ring-green-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${toneClass}`}
    >
      {children}
    </span>
  );
}

export function WorkspaceEmptyState({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center shadow-sm">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-gray-500">{description}</p>
      {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

type WorkspaceTone = "slate" | "green" | "amber" | "blue" | "red" | "violet";

function toneClass(tone: WorkspaceTone, outline = false) {
  const filled = {
    slate: "bg-slate-900 text-white hover:bg-slate-800",
    green: "bg-green-700 text-white hover:bg-green-800",
    amber: "bg-amber-500 text-white hover:bg-amber-600",
    blue: "bg-blue-600 text-white hover:bg-blue-700",
    red: "bg-rose-600 text-white hover:bg-rose-700",
    violet: "bg-violet-600 text-white hover:bg-violet-700",
  }[tone];
  const ghost = {
    slate: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    green: "border border-green-200 bg-green-50 text-green-700 hover:bg-green-100",
    amber: "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    blue: "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
    red: "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
    violet: "border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
  }[tone];
  return outline ? ghost : filled;
}

export function WorkspaceActionLink({
  href,
  tone = "slate",
  outline = false,
  children,
}: {
  href: string;
  tone?: WorkspaceTone;
  outline?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium transition ${toneClass(
        tone,
        outline,
      )}`}
    >
      {children}
    </Link>
  );
}

export function WorkspaceActionButton({
  tone = "slate",
  outline = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: WorkspaceTone;
  outline?: boolean;
}) {
  return (
    <button
      {...props}
      className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass(
        tone,
        outline,
      )} ${className}`}
    >
      {children}
    </button>
  );
}
