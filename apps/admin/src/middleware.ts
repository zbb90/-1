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
    (pathname === "/api/reviews" || pathname.startsWith("/api/reviews/")) &&
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

  if (isReviewsPagePath(request.nextUrl.pathname)) {
    const login = new URL("/reviews/login", request.url);
    login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
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
  matcher: ["/reviews", "/reviews/:path*", "/api/reviews", "/api/reviews/:path*"],
};
