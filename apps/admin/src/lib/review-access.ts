import type { NextRequest } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";

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
      requesterId: normalizeValue(
        request.nextUrl.searchParams.get("requesterId"),
      ),
    };
  }

  const requesterId = normalizeValue(request.headers.get("x-requester-id"));
  if (requesterId) {
    return {
      kind: "requester",
      requesterId,
    };
  }

  return {
    kind: "unauthorized",
    message: "请携带 x-requester-id，或使用主管后台登录后访问复核记录。",
  };
}
