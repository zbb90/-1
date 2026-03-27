import type { NextRequest } from "next/server";
import type { RequesterPayload } from "@/lib/types";

function normalizeValue(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function getRequesterIdFromRequest(request: NextRequest) {
  return (
    normalizeValue(request.headers.get("x-requester-id")) ||
    normalizeValue(request.nextUrl.searchParams.get("requesterId"))
  );
}

export function getRequesterPayloadFromRequest<T extends RequesterPayload>(
  request: NextRequest,
  body: T,
): T {
  const requesterId =
    normalizeValue(request.headers.get("x-requester-id")) ||
    normalizeValue(body.requesterId);
  const requesterName =
    normalizeValue(request.headers.get("x-requester-name")) ||
    normalizeValue(body.requesterName);

  return {
    ...body,
    requesterId,
    requesterName,
  };
}
