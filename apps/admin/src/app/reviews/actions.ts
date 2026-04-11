"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminCredentials, isAuthorizedAdminRequest } from "@/lib/admin-auth";
import {
  ADMIN_SESSION_COOKIE,
  LEGACY_ADMIN_COOKIES,
  getAdminSessionCookieOptions,
  getAdminSessionFromCookies,
  signAdminSessionValue,
} from "@/lib/admin-session";
import { sinkReviewTaskToKnowledge } from "@/lib/knowledge-sink";
import { updateReviewTask } from "@/lib/review-pool";
import { resolvePcLogin } from "@/lib/user-store";
import type { ReviewTaskStatus } from "@/lib/types";

async function assertAdminSessionOrBasic() {
  const cookieStore = await cookies();
  const headerList = await headers();

  const session = await getAdminSessionFromCookies(cookieStore);

  if (session || isAuthorizedAdminRequest(headerList).ok) {
    return true;
  }

  return false;
}

export type LoginFormState = { ok: false; message: string } | null;

export async function adminLoginAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const nextRaw = String(formData.get("next") ?? "/reviews").trim() || "/reviews";
  const next = nextRaw.startsWith("/") ? nextRaw : "/reviews";

  let login = await resolvePcLogin(phone, password);

  if (!login.ok) {
    const creds = getAdminCredentials();
    if (creds.isConfigured && phone === creds.username && password === creds.password) {
      login = {
        ok: true,
        role: "leader",
        leaderSessionKind: "primary",
        name: "负责人",
      };
    }
  }

  if (!login.ok) {
    return { ok: false, message: "手机号或密码不正确。" };
  }

  const leaderKind = login.role === "leader" ? login.leaderSessionKind : "none";
  const value = await signAdminSessionValue({
    sub: login.role === "leader" ? `pc-leader:${phone}` : `pc-supervisor:${phone}`,
    role: login.role,
    leaderKind,
    phone: phone.trim(),
    name: login.name,
  });
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, value, getAdminSessionCookieOptions());
  for (const legacyName of LEGACY_ADMIN_COOKIES) {
    cookieStore.delete(legacyName);
  }

  redirect(next);
}

export type SaveReviewFormState =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | null;

function buildRequesterReplyPatch(params: {
  status: ReviewTaskStatus;
  finalConclusion: string;
  finalExplanation: string;
}) {
  const shouldNotifyRequester =
    params.status === "已处理" ||
    params.status === "已加入知识库" ||
    params.status === "待补充" ||
    Boolean(params.finalConclusion.trim()) ||
    Boolean(params.finalExplanation.trim());

  if (!shouldNotifyRequester) {
    return {};
  }

  return {
    replyPublishedAt: new Date().toISOString(),
  };
}

function resolveFinalTaskStatus(params: {
  status: ReviewTaskStatus;
  finalConclusion: string;
  finalExplanation: string;
}) {
  const hasManualReply =
    Boolean(params.finalConclusion.trim()) || Boolean(params.finalExplanation.trim());

  if (
    hasManualReply &&
    (params.status === "待处理" || params.status === "AI已自动回答")
  ) {
    return "已处理" as const;
  }

  return params.status;
}

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

  const rawStatus = String(formData.get("status") ?? "").trim() as ReviewTaskStatus;
  const processor = String(formData.get("processor") ?? "").trim();
  const finalConclusion = String(formData.get("finalConclusion") ?? "").trim();
  const finalScore = String(formData.get("finalScore") ?? "").trim();
  const finalClause = String(formData.get("finalClause") ?? "").trim();
  const finalExplanation = String(formData.get("finalExplanation") ?? "").trim();
  const status = resolveFinalTaskStatus({
    status: rawStatus,
    finalConclusion,
    finalExplanation,
  });

  const allowed: ReviewTaskStatus[] = [
    "待处理",
    "AI已自动回答",
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
    ...buildRequesterReplyPatch({
      status,
      finalConclusion,
      finalExplanation,
    }),
  });

  if (!updated) {
    return { ok: false, message: "未找到对应复核任务。" };
  }

  return { ok: true, message: "保存成功，复核任务已更新。" };
}

export async function adminLogoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
  for (const legacyName of LEGACY_ADMIN_COOKIES) {
    cookieStore.delete(legacyName);
  }
  redirect("/reviews/login");
}

export async function saveAndSinkReviewTaskAction(
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

  const processor = String(formData.get("processor") ?? "").trim();
  const rawStatus = String(formData.get("status") ?? "").trim() as ReviewTaskStatus;
  const finalConclusion = String(formData.get("finalConclusion") ?? "").trim();
  const finalScore = String(formData.get("finalScore") ?? "").trim();
  const finalClause = String(formData.get("finalClause") ?? "").trim();
  const finalExplanation = String(formData.get("finalExplanation") ?? "").trim();
  const status = resolveFinalTaskStatus({
    status: rawStatus,
    finalConclusion,
    finalExplanation,
  });

  const updated = await updateReviewTask(id, {
    status,
    processor,
    finalConclusion,
    finalScore,
    finalClause,
    finalExplanation,
    ...buildRequesterReplyPatch({
      status,
      finalConclusion,
      finalExplanation,
    }),
  });

  if (!updated) {
    return { ok: false, message: "未找到对应复核任务。" };
  }

  try {
    const result = await sinkReviewTaskToKnowledge(id);
    const vectorStatus =
      result.audit.vectorSync === "synced"
        ? "已同步向量索引"
        : `已写入知识库，向量同步跳过：${result.audit.vectorSyncReason || "未配置"}`;
    return {
      ok: true,
      message: `已保存并加入知识库（${result.audit.table} / ${result.audit.newId}，${vectorStatus}）。`,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `主管结论已保存，但加入知识库失败：${error.message}`
          : "主管结论已保存，但加入知识库失败。",
    };
  }
}
