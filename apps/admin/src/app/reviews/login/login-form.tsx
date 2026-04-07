"use client";

import { useActionState } from "react";
import { adminLoginAction, type LoginFormState } from "../actions";

export function LoginForm({
  defaultNext,
  usingDefaults,
}: {
  defaultNext: string;
  usingDefaults?: boolean;
}) {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(
    adminLoginAction,
    null,
  );

  return (
    <form
      action={formAction}
      className="mx-auto max-w-md space-y-6 rounded-3xl bg-[var(--card)] p-8 shadow-sm ring-1 ring-[var(--border)]"
    >
      <div>
        <p className="text-sm font-medium text-green-700">主管后台</p>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">登录复核后台</h1>
        <p className="mt-2 text-sm text-gray-600">
          登录后浏览器会记住会话，避免保存复核结果时出现鉴权失败。
        </p>
      </div>

      {usingDefaults ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">当前使用内置默认凭据</p>
          <p className="mt-1">
            账号：<code className="font-mono font-bold">admin</code>　密码：
            <code className="font-mono font-bold">audit2026</code>
          </p>
          <p className="mt-1 text-xs text-amber-600">
            如需自定义，请在 Vercel 后台设置 ADMIN_BASIC_AUTH_USER /
            ADMIN_BASIC_AUTH_PASSWORD。
          </p>
        </div>
      ) : null}

      <input type="hidden" name="next" value={defaultNext} />

      <label className="flex flex-col gap-2 text-sm text-gray-700">
        <span>账号</span>
        <input
          name="username"
          autoComplete="username"
          required
          className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm text-gray-700">
        <span>密码</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-xl border border-gray-200 px-4 py-3 outline-none"
        />
      </label>

      {state?.ok === false ? (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-green-700 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-green-400"
      >
        {pending ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
