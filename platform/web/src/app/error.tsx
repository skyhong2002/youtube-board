"use client";
import { ErrorRecovery, type ErrorBoundaryProps } from "@/components/ErrorRecovery";
/** Shown when a public read fails with no last-good ISR page to serve (e.g. a first-load
 * 503). The failure still throws server-side so nothing is cached; the raw error and its
 * digest are never rendered. Report pages have their own boundary (ReportError). */
export default function ErrorPage(props: ErrorBoundaryProps) {
    return <ErrorRecovery {...props} />;
}
