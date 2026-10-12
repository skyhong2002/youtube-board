import { notFound } from "next/navigation";
import { decodeReportSegments, resolveRoute } from "@/lib/routes";
import { ReportPage } from "@/lib/report-pages";
import { enablePublicRevalidation } from "@/lib/api";
// Canonical, query-free report: params-only ISR. The proxy rewrites every query
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
    return { title: resolveRoute(segments)?.title || "找不到頁面" };
}
export default async function Report({ params }: Props) {
    enablePublicRevalidation();
    const segments = decodeReportSegments((await params).segments);
    if (!segments) notFound();
    const route = resolveRoute(segments);
    if (!route) notFound();
    return (
        <ReportPage
            route={route}
            search={{}}
            path={`/${segments.map(encodeURIComponent).join("/")}`}
        />
    );
}
