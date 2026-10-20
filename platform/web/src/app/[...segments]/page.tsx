import { notFound } from "next/navigation";
import { decodeReportSegments, resolveRoute } from "@/lib/routes";
import { ReportPage } from "@/lib/report-pages";
import { enablePublicRevalidation } from "@/lib/api";
import { breadcrumbJsonLd, privateMetadata, reportBreadcrumbs, reportIndexable, reportMetadata, videoJsonLd } from "@/lib/seo";
import { reportSubject } from "@/lib/seo-data";
import JsonLd from "@/components/JsonLd";
import { taipeiToday } from "@/lib/ai-hours-board";
// A daily AI page after Taipei today can only be empty; it is not a report yet.
const futureDay = (route: { kind: string; id?: string }) => route.kind === "ai-days" && !!route.id && route.id > taipeiToday();
// Canonical, query-free report: params-only ISR. The proxy routes every query
// variant to /render-filtered/report, which keeps the dynamic semantics.
export const revalidate = 60;
export const dynamicParams = true;
export async function generateStaticParams() {
    // Nothing is prerendered at build time, when the API may be unavailable.
    return [];
}
type Props = {
    params: Promise<{ segments: string[] }>;
};
export async function generateMetadata({ params }: Props) {
    // Next metadata receives the original decoded params; unlike the page's
    // getDynamicParam values, decoding these would corrupt literal percent terms.
    const {segments} = await params;
    const route = resolveRoute(segments);
    if (!route || futureDay(route)) return privateMetadata("找不到頁面");
    // Same per-request switch as the page, so the subject read below uses the shared
    // revalidated cache rather than a no-store fetch that would make this page dynamic.
    enablePublicRevalidation();
    return reportMetadata(route, segments, await reportSubject(route));
}
export default async function Report({ params }: Props) {
    enablePublicRevalidation();
    const segments = decodeReportSegments((await params).segments);
    if (!segments) notFound();
    const route = resolveRoute(segments);
    if (!route || futureDay(route)) notFound();
    const subject = await reportSubject(route);
    return (
        <>
            {reportIndexable(route, segments) && <JsonLd data={breadcrumbJsonLd(reportBreadcrumbs(route, segments, subject))} />}
            {subject?.kind === "video" && <JsonLd data={videoJsonLd(subject.video, subject.durationSeconds)} />}
            <ReportPage
                route={route}
                search={{}}
                path={`/${segments.map(encodeURIComponent).join("/")}`}
            />
        </>
    );
}
