import type { NextRequest } from "next/server";
import { isAdminSessionOrBasicAuthorized } from "@/lib/admin-session";
import { getRequesterIdFromRequest } from "@/lib/requester";
import { resolvePcLogin } from "@/lib/user-store";

function normalizeValue(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseBasicAuth(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Basic ")) return null;
  try {
    const decoded = atob(authorization.slice("Basic ".length));
    const colon = decoded.indexOf(":");
    if (colon === -1) return null;
    return {
      user: decoded.slice(0, colon),
      pass: decoded.slice(colon + 1),
    };
  } catch {
    return null;
  }
}

async function tryPhonePasswordAuth(request: NextRequest) {
  const creds = parseBasicAuth(request);
  if (!creds?.user || !creds?.pass) return false;
  const result = await resolvePcLogin(creds.user, creds.pass);
  return result.ok;
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

  if (await tryPhonePasswordAuth(request)) {
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
