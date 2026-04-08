import type { NextRequest } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { getRequesterIdFromRequest } from "@/lib/requester";

function normalizeValue(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export type ReviewReadScope =
  | {
      kind: "admin";
      requesterId?: string;
    }
  | {
      kind: "requester";
      requesterId: string;
    }
  | {
      kind: "unauthorized";
      message: string;
    };

export async function getReviewReadScope(
  request: NextRequest,
): Promise<ReviewReadScope> {
  if (await isAdminSessionOrBasicAuthorized(request)) {
    return {
      kind: "admin",
      requesterId: normalizeValue(request.nextUrl.searchParams.get("requesterId")),
    };
  }

  const requesterId = normalizeValue(await getRequesterIdFromRequest(request));
  if (requesterId) {
    return {
      kind: "requester",
      requesterId,
    };
  }

  return {
    kind: "unauthorized",
    message: "请先完成小程序登录，或使用主管后台登录后访问复核记录。",
  };
}
