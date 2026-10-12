import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { legacyRedirect } from "../../shared/legacy-redirects";
import { reportRequestStatus } from "./lib/request-status";
import { validImageOptimizationQuery } from "../../shared/image-policy";
import { publicRenderDecision, queryVariantRobots, type RenderDecision } from "./lib/public-render";
import { INTERNAL_RENDER_HEADER, PUBLIC_RENDER_HEADER, THEME_SCRIPT } from "../../shared/public-render-contract";
// The gateway owns the final script policy (fixed inline hashes + build SRI). HTML may be
// shared ISR output, so nothing here is per-request: no nonce, no script 'unsafe-inline'.
// The enforced fallback only carries directives that cannot break Next scripts.
const baseDirectives = "style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self'; media-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src https://www.youtube-nocookie.com https://www.youtube.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const themeHash = createHash("sha256").update(THEME_SCRIPT).digest("base64");
// Deliberately incomplete Report-Only policy: it trusts only the theme script, not Next's
// inline bootstrap/Flight scripts, so requests made straight to the loopback Next listener
// log violations. The gateway removes both CSP headers and enforces the full policy;
// production traffic never reaches Next without it.
const reportOnlyPolicy = `default-src 'self'; script-src 'self' 'sha256-${themeHash}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; ${baseDirectives}`;
// Never let a client choose a nonce Next would copy into scripts, pre-mark eligibility or
// pick an internal render target.
const untrustedRequestHeaders = ["x-nonce", "content-security-policy", "content-security-policy-report-only", PUBLIC_RENDER_HEADER, INTERNAL_RENDER_HEADER];
function securedResponse(request: NextRequest, decision: Extract<RenderDecision, { kind: "render" }>) {
    const headers = new Headers(request.headers);
    for (const name of untrustedRequestHeaders) headers.delete(name);
    // No NextResponse.rewrite (see INTERNAL_RENDER_HEADER): the override header selects a
    // relative next.config beforeFiles rewrite inside the same router pass.
    if (decision.target) headers.set(INTERNAL_RENDER_HEADER, decision.target);
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("Content-Security-Policy", baseDirectives);
    response.headers.set("Content-Security-Policy-Report-Only", reportOnlyPolicy);
    response.headers.delete(PUBLIC_RENDER_HEADER);
    // Eligible responses keep Next's ISR Cache-Control; the gateway decides the shared TTL
    // after its own success / Set-Cookie / RSC / private checks.
    if (decision.eligible) response.headers.set(PUBLIC_RENDER_HEADER, decision.eligible);
    else response.headers.set("Cache-Control", "private, no-store");
    const robots = queryVariantRobots(request.nextUrl);
    if (robots) response.headers.set("X-Robots-Tag", robots);
    return response;
}
export function proxy(request: NextRequest) {
    if (request.nextUrl.pathname === "/_next/image") return validImageOptimizationQuery(request.nextUrl.searchParams)
        ? NextResponse.next() : new NextResponse("Invalid image request", { status: 400, headers: { "Cache-Control": "no-store" } });
    const url = new URL(request.url);
    const decision = publicRenderDecision(url, request.method);
    if (decision.kind === "blocked") return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    const invalid = reportRequestStatus(url);
    if (invalid) return new NextResponse(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>${invalid.status}</title><body><main><h1>${invalid.status}</h1><p>${invalid.message}</p><a href="/">回到 有影儀表板</a></main></body></html>`, {
        status: invalid.status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'" },
    });
    const target = legacyRedirect(request.url);
    return target
        ? NextResponse.redirect(new URL(target, request.url), 308)
        : securedResponse(request, decision);
}
export const config = {
    matcher: [
        "/((?!(?:api|auth|feeds|media|brand)(?:/|$)|_next/(?:static|image)(?:/|$)|(?:favicon\\.ico|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml)$).*)",
        "/_next/image",
        // Exact HTML pages only; /api/v1/*, /api/ops/* and /auth stay outside the proxy.
        "/api",
        "/api/status",
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
