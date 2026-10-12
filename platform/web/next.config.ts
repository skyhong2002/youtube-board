import type { NextConfig } from "next";
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
        return process.env.NODE_ENV === "development"
            ? [{ source: "/media/channels/:id/:revision", destination: "http://127.0.0.1:4100/media/channels/:id/:revision" }]
            : [];
    },
    allowedDevOrigins: (
        process.env.YOUTUBE_ALLOWED_DEV_ORIGINS || "100.85.214.25"
    )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    poweredByHeader: false,
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
