import { notFound } from "next/navigation";
import { decodeReportSegments, resolveRoute } from "@/lib/routes";
import { ReportPage } from "@/lib/report-pages";
import type { Search } from "@/lib/api";
import { withoutTransportParams } from "@/lib/public-render";
// Internal rewrite target for report URLs that carry a query; never cached. The
// browser keeps the canonical path, and `path` below is rebuilt from the same segments.
export const dynamic = "force-dynamic";
type Props = {
    params: Promise<{ segments: string[] }>;
    searchParams: Promise<Search>;
};
export async function generateMetadata({ params }: Props) {
    const {segments} = await params;
    return { title: resolveRoute(segments)?.title || "找不到頁面" };
}
export default async function FilteredReport({ params, searchParams }: Props) {
    const segments = decodeReportSegments((await params).segments);
    if (!segments) notFound();
    const route = resolveRoute(segments);
    if (!route) notFound();
    return (
        <ReportPage
            route={route}
            search={withoutTransportParams(await searchParams)}
            path={`/${segments.map(encodeURIComponent).join("/")}`}
        />
    );
}
