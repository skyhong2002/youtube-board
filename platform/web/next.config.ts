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
    async rewrites() {
        return {
            // Internal render targets chosen by the proxy (see INTERNAL_RENDER_HEADER).
            beforeFiles: internalRenderRewrites,
            afterFiles: process.env.NODE_ENV === "development"
                ? [{ source: "/media/channels/:id/:revision", destination: "http://127.0.0.1:4100/media/channels/:id/:revision" }]
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
    poweredByHeader: false,
    // ISR pages and public data reads stay in a bounded in-memory LRU; the runtime
    // filesystem is read-only, so nothing is flushed to disk.
    cacheMaxMemorySize: 64 * 1024 * 1024,
    experimental: { isrFlushToDisk: false },
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
