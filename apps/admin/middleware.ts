import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/admin-auth";

function isProtectedPath(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname === "/reviews" || pathname.startsWith("/reviews/")) {
    return true;
  }

  if (
    (pathname === "/api/reviews" || pathname.startsWith("/api/reviews/")) &&
    request.method !== "GET"
  ) {
    return true;
  }

  return false;
}

export function middleware(request: NextRequest) {
  if (!isProtectedPath(request)) {
    return NextResponse.next();
  }

  const result = isAuthorizedAdminRequest(request.headers);
  if (result.ok) {
    return NextResponse.next();
  }

  return new NextResponse(result.reason, {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="audit-ai-admin"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export const config = {
  matcher: ["/reviews/:path*", "/api/reviews/:path*"],
};
