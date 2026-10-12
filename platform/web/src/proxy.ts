import { NextResponse, type NextRequest } from "next/server";
import { legacyRedirect } from "../../shared/legacy-redirects";
import { reportRequestStatus } from "./lib/request-status";
import { validImageOptimizationQuery } from "../../shared/image-policy";
function securedResponse(request: NextRequest) {
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://www.youtube.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`;
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce); headers.set('Content-Security-Policy', csp);
    const response = NextResponse.next({request:{headers}});
    response.headers.set('Content-Security-Policy', csp);
    // Nonces must never be shared by an intermediary HTML cache.
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
}
export function proxy(request: NextRequest) {
    if (request.nextUrl.pathname === "/_next/image") return validImageOptimizationQuery(request.nextUrl.searchParams)
        ? NextResponse.next() : new NextResponse("Invalid image request", { status: 400, headers: { "Cache-Control": "no-store" } });
    const invalid = reportRequestStatus(new URL(request.url));
    if (invalid) return new NextResponse(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>${invalid.status}</title><body><main><h1>${invalid.status}</h1><p>${invalid.message}</p><a href="/">回到 有影儀表板</a></main></body></html>`, {
        status: invalid.status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'" },
    });
    const target = legacyRedirect(request.url);
    return target
        ? NextResponse.redirect(new URL(target, request.url), 308)
        : securedResponse(request);
}
export const config = {
    matcher: [
        "/((?!(?:api|auth|feeds|media|brand)(?:/|$)|_next/(?:static|image)(?:/|$)|(?:favicon\\.ico|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml)$).*)",
        "/_next/image",
        "/boards",
        "/boards/view",
        "/videos/:id/analytics",
        "/:legacy([^/]+\\.php)",
        "/ch/:path*",
        "/rank/:id",
        "/day/:date/:condition",
        "/mayor/:legacy([^/]+\\.php)",
        "/mayor/:legacy(html_[A-Za-z0-9_]+\\.html)",
        "/html/:path*",
    ],
};
