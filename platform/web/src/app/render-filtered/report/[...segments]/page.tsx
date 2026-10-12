import { notFound } from "next/navigation";
import { decodeReportSegments, resolveRoute } from "@/lib/routes";
import { ReportPage } from "@/lib/report-pages";
import type { Search } from "@/lib/api";
import { withoutTransportParams } from "@/lib/public-render";
import { filteredReportMetadata, privateMetadata } from "@/lib/seo";
// Internal rewrite target for report URLs that carry a query; never cached. The
// browser keeps the canonical path, and `path` below is rebuilt from the same segments.
export const dynamic = "force-dynamic";
type Props = {
    params: Promise<{ segments: string[] }>;
    searchParams: Promise<Search>;
};
// Query variants are never indexed and canonicalize to the query-free report; no data
// read here keeps this render as cheap as before. Metadata params arrive already decoded
// (see [...segments]/page.tsx), so they are not decoded again.
export async function generateMetadata({ params }: Props) {
    const {segments} = await params;
    const route = resolveRoute(segments);
    return route ? filteredReportMetadata(route, segments) : privateMetadata("找不到頁面");
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
