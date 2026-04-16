"use client";

import { useActionState } from "react";
import {
  WorkspaceActionButton,
  WorkspaceSection,
} from "@/components/admin/knowledge-workspace";
import { adminLoginAction, type LoginFormState } from "../actions";

export function LoginForm({ defaultNext }: { defaultNext: string }) {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(
    adminLoginAction,
    null,
  );

  return (
    <WorkspaceSection
      title="登录"
      description="负责人和主管可登录管理后台，专员请继续使用小程序。"
      className="w-full max-w-md"
    >
      <form action={formAction} className="space-y-6">
        <div>
          <p className="text-sm font-medium text-green-700">稽核管理后台</p>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            使用手机号或管理账号登录，进入统一工作台处理复核、知识库和问答日志。
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

        <WorkspaceActionButton
          type="submit"
          disabled={pending}
          tone="green"
          className="w-full justify-center px-5 py-3"
        >
          {pending ? "登录中…" : "登录"}
        </WorkspaceActionButton>

        <p className="text-center text-xs text-gray-400">主管账号由负责人在后台创建</p>
      </form>
    </WorkspaceSection>
  );
}
