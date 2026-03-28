import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/admin-auth";
import { verifyAdminSessionFromRequest } from "@/lib/admin-session";

function isReviewsLoginPath(pathname: string) {
  return pathname === "/reviews/login" || pathname.startsWith("/reviews/login/");
}

function isReviewsPagePath(pathname: string) {
  return pathname === "/reviews" || pathname.startsWith("/reviews/");
}

function isProtectedPath(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isReviewsLoginPath(pathname)) {
    return false;
  }

  if (isReviewsPagePath(pathname)) {
    return true;
  }

  if (
    pathname === "/conversations" ||
    pathname.startsWith("/conversations/")
  ) {
    return true;
  }

  if (
    pathname === "/knowledge" ||
    pathname.startsWith("/knowledge/")
  ) {
    return true;
  }

  if (
    (pathname === "/api/reviews" || pathname.startsWith("/api/reviews/")) &&
    request.method !== "GET"
  ) {
    return true;
  }

  if (
    (pathname === "/api/knowledge/sink" ||
      pathname.startsWith("/api/knowledge/rules") ||
      pathname.startsWith("/api/knowledge/consensus") ||
      pathname.startsWith("/api/knowledge/external-purchases") ||
      pathname.startsWith("/api/knowledge/old-items")) &&
    request.method !== "GET"
  ) {
    return true;
  }

  return false;
}

export async function middleware(request: NextRequest) {
  if (!isProtectedPath(request)) {
    return NextResponse.next();
  }

  if (isAuthorizedAdminRequest(request.headers).ok) {
    return NextResponse.next();
  }

  if (await verifyAdminSessionFromRequest(request)) {
    return NextResponse.next();
  }

  const pn = request.nextUrl.pathname;
  const isPageRequest =
    isReviewsPagePath(pn) ||
    pn === "/conversations" ||
    pn.startsWith("/conversations/") ||
    pn === "/knowledge" ||
    pn.startsWith("/knowledge/");

  if (isPageRequest) {
    const login = new URL("/reviews/login", request.url);
    login.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(login);
  }

  return new NextResponse("后台处理接口需要管理员身份验证。", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="audit-ai-admin"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export const config = {
  matcher: [
    "/reviews",
    "/reviews/:path*",
    "/conversations",
    "/conversations/:path*",
    "/knowledge",
    "/knowledge/:path*",
    "/api/reviews",
    "/api/reviews/:path*",
    "/api/knowledge/:path*",
  ],
};
