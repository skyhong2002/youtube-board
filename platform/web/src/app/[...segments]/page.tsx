import { notFound } from "next/navigation";
import { decodeReportSegments, resolveRoute } from "@/lib/routes";
import { ReportPage } from "@/lib/report-pages";
import type { Search } from "@/lib/api";
export const dynamic = "force-dynamic";
type Props = {
    params: Promise<{ segments: string[] }>;
    searchParams: Promise<Search>;
};
export async function generateMetadata({ params }: Props) {
    // Next metadata receives the original decoded params; unlike the page's
    // getDynamicParam values, decoding these would corrupt literal percent terms.
    const {segments} = await params;
    return { title: resolveRoute(segments)?.title || "找不到頁面" };
}
export default async function Report({ params, searchParams }: Props) {
    const segments = decodeReportSegments((await params).segments);
    if (!segments) notFound();
    const route = resolveRoute(segments);
    if (!route) notFound();
    return (
        <ReportPage
            route={route}
            search={await searchParams}
            path={`/${segments.map(encodeURIComponent).join("/")}`}
        />
    );
}
