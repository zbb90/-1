import type { NextRequest } from "next/server";
import { verifyJwt } from "@/lib/jwt";
import type { RequesterPayload } from "@/lib/types";

function normalizeValue(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function getBearerToken(request: NextRequest) {
  const authorization = normalizeValue(request.headers.get("authorization"));
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  return normalizeValue(authorization.slice("Bearer ".length));
}

export async function getRequesterIdFromRequest(request: NextRequest) {
  const token = getBearerToken(request);
  if (token) {
    const payload = await verifyJwt(token);
    if (payload?.sub) {
      return payload.sub;
    }
  }
  return undefined;
}

export async function getRequesterPayloadFromRequest<T extends RequesterPayload>(
  request: NextRequest,
  body: T,
): Promise<T> {
  const token = getBearerToken(request);
  const jwtPayload = token ? await verifyJwt(token) : null;
  const requesterId = jwtPayload?.sub;
  const requesterName =
    jwtPayload?.name ||
    normalizeValue(request.headers.get("x-requester-name")) ||
    normalizeValue(body.requesterName);

  return {
    ...body,
    requesterId,
    requesterName,
  };
}
