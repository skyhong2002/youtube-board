import {reportSubject} from '@/lib/seo-data';
import JsonLd from '@/components/JsonLd';
import { notFound } from "next/navigation";
import { decodeReportSegments, resolveRoute } from "@/lib/routes";
import { ReportPage } from "@/lib/report-pages";
import type { Search } from "@/lib/api";
import { withoutTransportParams, canonicalKeywordProfile } from "@/lib/public-render";
import { filteredReportMetadata, privateMetadata, reportMetadata, reportIndexable, breadcrumbJsonLd, reportBreadcrumbs } from "@/lib/seo";
// Dynamic rewrite target for queried reports and canonical keyword profiles; never cached. The
// browser keeps the canonical path, and `path` below is rebuilt from the same segments.
export const dynamic = "force-dynamic";
type Props = {
    params: Promise<{ segments: string[] }>;
    searchParams: Promise<Search>;
};
// Query variants are never indexed; canonical keyword profiles retain their metadata
// and breadcrumb JSON-LD. Metadata params arrive already decoded
// (see [...segments]/page.tsx), so they are not decoded again.
export async function generateMetadata({ params, searchParams }: Props) {
    const {segments} = await params;
    const route = resolveRoute(segments);
    if (!route) return privateMetadata("找不到頁面");
    const search=withoutTransportParams(await searchParams);
    // Canonical keyword profiles are dynamic for metadata privacy, still indexable.
    if (canonicalKeywordProfile(route.kind,search))
        return reportMetadata(route,segments,await reportSubject(route));
    return filteredReportMetadata(route, segments);
}
export default async function FilteredReport({ params, searchParams }: Props) {
    const segments = decodeReportSegments((await params).segments);
    if (!segments) notFound();
    const route = resolveRoute(segments);
    if (!route) notFound();
    const search=withoutTransportParams(await searchParams);
    const canonical=canonicalKeywordProfile(route.kind,search);
    const subject=canonical?await reportSubject(route):null;
    return (<>
        {canonical&&reportIndexable(route,segments)&&<JsonLd data={breadcrumbJsonLd(reportBreadcrumbs(route,segments,subject))}/>}
        <ReportPage
            route={route}
            search={search}
            path={`/${segments.map(encodeURIComponent).join("/")}`}
        />
    </>);
}
