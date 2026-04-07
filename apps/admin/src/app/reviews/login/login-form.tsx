"use client";

import { useActionState } from "react";
import { adminLoginAction, type LoginFormState } from "../actions";

export function LoginForm({ defaultNext }: { defaultNext: string }) {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(
    adminLoginAction,
    null,
  );

  return (
    <form
      action={formAction}
      className="mx-auto max-w-md space-y-6 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-gray-200"
    >
      <div>
        <p className="text-sm font-medium text-green-700">稽核管理后台</p>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">登录</h1>
        <p className="mt-2 text-sm text-gray-600">
          负责人和主管可登录管理后台。专员请使用小程序。
        </p>
      </div>

      <input type="hidden" name="next" value={defaultNext} />

      <label className="flex flex-col gap-2 text-sm text-gray-700">
        <span>手机号 / 账号</span>
        <input
          name="phone"
          autoComplete="tel"
          required
          placeholder="输入手机号或管理账号"
          className="rounded-xl border border-gray-200 px-4 py-3 outline-none transition focus:border-green-400"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm text-gray-700">
        <span>密码</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="输入密码"
          className="rounded-xl border border-gray-200 px-4 py-3 outline-none transition focus:border-green-400"
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
        className="w-full rounded-xl bg-green-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-green-400"
      >
        {pending ? "登录中…" : "登录"}
      </button>

      <p className="text-center text-xs text-gray-400">主管账号由负责人在后台创建</p>
    </form>
  );
}
