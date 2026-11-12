"use client";
import { usePathname } from "next/navigation";
import { ErrorRecovery, type ErrorBoundaryProps } from "./ErrorRecovery";
import { reportFamilyIndex } from "@/lib/report-family-index";
/** error.tsx body for report segments: the root page's retry and auto re-read, plus a link back to the
 * report family's listing (e.g. a failed channel report offers 頻道觀測). The browser keeps the public
 * path while the proxy renders /render-filtered, so usePathname is the reader's URL. */
export function ReportError(props: ErrorBoundaryProps) {
    return <ErrorRecovery {...props} back={reportFamilyIndex(usePathname())} />;
}
