import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/admin-auth";
import { getAdminRequestContext } from "@/lib/admin-session";

function isLoginPath(pathname: string) {
  return pathname === "/reviews/login" || pathname.startsWith("/reviews/login/");
}

function isLeaderOnlyPath(pathname: string) {
  return (
    pathname === "/users" ||
    pathname.startsWith("/users/") ||
    pathname === "/storage" ||
    pathname.startsWith("/storage/")
  );
}

function isProtectedPagePath(pathname: string) {
  if (isLoginPath(pathname)) return false;

  if (pathname === "/reviews" || pathname.startsWith("/reviews/")) return true;
  if (pathname === "/conversations" || pathname.startsWith("/conversations/"))
    return true;
  if (pathname === "/knowledge" || pathname.startsWith("/knowledge/")) return true;
  if (isLeaderOnlyPath(pathname)) return true;

  return false;
}

function isProtectedApiPath(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (
    (pathname === "/api/reviews" || pathname.startsWith("/api/reviews/")) &&
    request.method !== "GET"
  )
    return true;

  if (
    (pathname === "/api/knowledge/sink" ||
      pathname.startsWith("/api/knowledge/rules") ||
      pathname.startsWith("/api/knowledge/consensus") ||
      pathname.startsWith("/api/knowledge/external-purchases") ||
      pathname.startsWith("/api/knowledge/old-items")) &&
    request.method !== "GET"
  )
    return true;

  if (pathname === "/api/users" || pathname.startsWith("/api/users/")) return true;
  if (pathname === "/api/storage" || pathname.startsWith("/api/storage/")) return true;

  return false;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPage = isProtectedPagePath(pathname);
  const isApi = isProtectedApiPath(request);

  if (!isPage && !isApi) {
    return NextResponse.next();
  }

  if (isAuthorizedAdminRequest(request.headers).ok) {
    return NextResponse.next();
  }

  const admin = await getAdminRequestContext(request);

  if (!admin.authorized) {
    if (isPage) {
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

  if (
    isLeaderOnlyPath(pathname) ||
    pathname === "/api/users" ||
    pathname.startsWith("/api/users/")
  ) {
    if (!admin.isLeader) {
      if (isPage) {
        return NextResponse.redirect(new URL("/reviews", request.url));
      }
      return NextResponse.json({ error: "需要负责人权限" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/reviews",
    "/reviews/:path*",
    "/conversations",
    "/conversations/:path*",
    "/knowledge",
    "/knowledge/:path*",
    "/users",
    "/users/:path*",
    "/storage",
    "/storage/:path*",
    "/api/reviews",
    "/api/reviews/:path*",
    "/api/knowledge/:path*",
    "/api/users",
    "/api/users/:path*",
    "/api/storage",
    "/api/storage/:path*",
  ],
};
