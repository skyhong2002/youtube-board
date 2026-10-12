import { api, type VideoCollection } from "@/lib/api";
import { boardApiQuery, boardUrl, parseBoardRequest } from "@/lib/boards";
import { videoFeed, feedOrigin } from "@/lib/feed";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
    const url = new URL(request.url);
    const parsed = parseBoardRequest(url.searchParams);
    if (!parsed) return new Response("Invalid board filters", { status: 400, headers: { "Cache-Control": "no-store" } });
    const { board: scope, offset } = parsed;
    const result = await api<VideoCollection>("videos", boardApiQuery(scope, 100, offset));
    if (!result.ok && result.status >= 400 && result.status < 500) return new Response("Video request could not be served", { status: result.status, headers: { "Cache-Control": "no-store" } });
    if (!result.ok)
        return new Response("Video data is temporarily unavailable", {
            status: 503,
            headers: { "Retry-After": "300", "Cache-Control": "no-store" },
        });
    const publicOrigin = feedOrigin(
        process.env.YOUTUBE_PUBLIC_URL,
        process.env.NODE_ENV === "production",
        request.url,
        request.headers.get("host"),
        [
            "localhost",
            "127.0.0.1",
            ...(process.env.YOUTUBE_ALLOWED_DEV_ORIGINS || "100.85.214.25")
                .split(",")
                .map((value) => value.trim()),
        ],
    );
    if (!publicOrigin)
        return new Response("The public RSS origin is not configured", {
            status: 503,
            headers: { "Cache-Control": "no-store" },
        });
    const board = new URL(boardUrl(scope), publicOrigin);
    if (offset) board.searchParams.set("offset", String(offset));
    const { data, meta } = result.response;
    return new Response(
        videoFeed({
            rows: data.rows,
            title: scope.name || scope.keyword || scope.query ? `有影儀表板：${scope.name || scope.keyword || scope.query}` : "有影儀表板影片",
            link: board.href,
            updatedAt: meta.updatedAt,
            fixture: meta.dataset === "fixture",
        }),
        {
            headers: {
                "Content-Type": "application/rss+xml; charset=utf-8",
                "Cache-Control": process.env.YOUTUBE_PUBLIC_URL
                    ? "public, max-age=300"
                    : "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        },
    );
}
