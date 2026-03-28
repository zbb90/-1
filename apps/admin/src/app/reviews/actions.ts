"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminCredentials, isAuthorizedAdminRequest } from "@/lib/admin-auth";
import {
  ADMIN_SESSION_COOKIE,
  signAdminSessionValue,
  verifyAdminSessionCookieValue,
} from "@/lib/admin-session";
import { updateReviewTask } from "@/lib/review-pool";
import type { ReviewTaskStatus } from "@/lib/types";

async function assertAdminSessionOrBasic() {
  const cookieStore = await cookies();
  const headerList = await headers();

  const cookieOk = await verifyAdminSessionCookieValue(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
  );

  if (cookieOk || isAuthorizedAdminRequest(headerList).ok) {
    return true;
  }

  return false;
}

export type LoginFormState = { ok: false; message: string } | null;

export async function adminLoginAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const nextRaw = String(formData.get("next") ?? "/reviews").trim() || "/reviews";
  const next = nextRaw.startsWith("/") ? nextRaw : "/reviews";

  const creds = getAdminCredentials();
  if (!creds.isConfigured) {
    return { ok: false, message: "后台未配置账号密码。" };
  }

  if (username !== creds.username || password !== creds.password) {
    return { ok: false, message: "账号或密码不正确。" };
  }

  const value = await signAdminSessionValue();
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  redirect(next);
}

export type SaveReviewFormState =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | null;

export async function saveReviewTaskAction(
  _prev: SaveReviewFormState,
  formData: FormData,
): Promise<SaveReviewFormState> {
  if (!(await assertAdminSessionOrBasic())) {
    return { ok: false, message: "登录已失效，请重新登录后台。" };
  }

  const id = String(formData.get("taskId") ?? "").trim();
  if (!id) {
    return { ok: false, message: "缺少任务编号。" };
  }

  const status = String(formData.get("status") ?? "").trim() as ReviewTaskStatus;
  const processor = String(formData.get("processor") ?? "").trim();
  const finalConclusion = String(formData.get("finalConclusion") ?? "").trim();
  const finalScore = String(formData.get("finalScore") ?? "").trim();
  const finalClause = String(formData.get("finalClause") ?? "").trim();
  const finalExplanation = String(formData.get("finalExplanation") ?? "").trim();

  const allowed: ReviewTaskStatus[] = [
    "待处理",
    "已处理",
    "已加入知识库",
    "待补充",
  ];

  if (!allowed.includes(status)) {
    return { ok: false, message: "任务状态不合法。" };
  }

  const updated = await updateReviewTask(id, {
    status,
    processor,
    finalConclusion,
    finalScore,
    finalClause,
    finalExplanation,
  });

  if (!updated) {
    return { ok: false, message: "未找到对应复核任务。" };
  }

  return { ok: true, message: "保存成功，复核任务已更新。" };
}

export async function adminLogoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
  redirect("/reviews/login");
}
