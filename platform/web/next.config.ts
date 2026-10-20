import type { NextConfig } from "next";
// Literal copy of internalRenderRewrites() in shared/public-render-contract.ts (asserted equal
// by public-render.test.ts); kept import-free so config loading needs no TS require hook.
const render = (value: "home" | "events" | "filtered") => [{ type: "header" as const, key: "x-youtube-board-render", value }];
const internalRenderRewrites = [
    { source: "/", has: render("home"), destination: "/render-isr/home/current" },
    { source: "/events", has: render("events"), destination: "/render-isr/events/current" },
    { source: "/:family(channels|videos|tags|keywords|vocabulary|live|ai|groups|mayor|comments)/:rest*", has: render("filtered"), destination: "/render-filtered/report/:family/:rest*" },
];
const config: NextConfig = {
    output: "standalone",
    images: {
        remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com", port: "", pathname: "/vi/*/mqdefault.jpg", search: "" }],
        localPatterns: [],
        imageSizes: [48, 96, 160, 192, 320], deviceSizes: [640], qualities: [75],
        maximumRedirects: 0, dangerouslyAllowLocalIP: false, dangerouslyAllowSVG: false,
        maximumResponseBody: 2 * 1024 * 1024, maximumDiskCacheSize: 128 * 1024 * 1024,
    },
    // The three brand candidates were folded into one flat set; already-shared OG
    // images and installed icons keep resolving to the same file name.
    async redirects() {
        return [
            { source: "/brand/:kind(family|legacy|original)/:file", destination: "/brand/:file", permanent: true },
            // The admin area moved from /manage to /admin on 2026-10-17; keep old bookmarks working.
            { source: "/manage", destination: "/admin", permanent: true },
            { source: "/manage/:path*", destination: "/admin/:path*", permanent: true },
            // Event/channel curation is hidden (not used, production writes off); temporary so it can return.
            { source: "/admin/editorial", destination: "/admin", permanent: false },
            // Editorial events are not curated, so the timeline is always empty; temporary so it can return.
            { source: "/events", destination: "/ai/days", permanent: false },
            { source: "/events/:path*", destination: "/ai/days", permanent: false },
        ];
    },
    async rewrites() {
        return {
            // Internal render targets chosen by the proxy (see INTERNAL_RENDER_HEADER).
            beforeFiles: internalRenderRewrites,
            afterFiles: process.env.NODE_ENV === "development"
                ? [
                    // Dev only: forward cached avatar PNGs (/:id/:rev.png) and their WebP derivatives
                    // (/:id/:rev/:width.webp) to the local API; production routes /media at the gateway.
                    { source: "/media/channels/:id/:revision", destination: "http://127.0.0.1:4100/media/channels/:id/:revision" },
                    { source: "/media/channels/:id/:revision/:width", destination: "http://127.0.0.1:4100/media/channels/:id/:revision/:width" },
                    { source: "/media/tag-illustrations/:keyword/:kind/:revision", destination: "http://127.0.0.1:4100/media/tag-illustrations/:keyword/:kind/:revision" },
                ]
                : [],
            fallback: [],
        };
    },
    allowedDevOrigins: (
        process.env.YOUTUBE_ALLOWED_DEV_ORIGINS || "100.85.214.25"
    )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    // /api and /api/status read the generated ../docs/api.md at prerender and ISR
    // regeneration (lib/api-docs-source.ts); fs reads are not traced, so package it explicitly.
    outputFileTracingIncludes: { "/api": ["../docs/api.md"], "/api/status": ["../docs/api.md"] },
    poweredByHeader: false,
    // ISR pages and public data reads stay in a bounded in-memory LRU; the runtime
    // filesystem is read-only, so nothing is flushed to disk.
    cacheMaxMemorySize: 64 * 1024 * 1024,
    // User-explicit cap: next build uses up to 2 workers (build/index.js getNumberOfWorkers
    // treats a non-default experimental.cpus as an override).
    experimental: { isrFlushToDisk: false, cpus: 2 },
    logging: { incomingRequests: { ignore: [/^\/auth(?:\/|$)/, /^\/feeds\/u\//, /^\/api\/ops\/editorial(?:\/|$)/] } },
    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "Strict-Transport-Security", value: "max-age=31536000" },
                    {
                        key: "Referrer-Policy",
                        value: "strict-origin-when-cross-origin",
                    },
                    { key: "X-Frame-Options", value: "SAMEORIGIN" },
                ],
            },
        ];
    },
};
export default config;
