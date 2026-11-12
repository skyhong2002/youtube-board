'use client';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { navigationTarget } from './NavPending';
import { ReportSkeleton } from './ReportSkeleton';
import { isReportPath } from '@/lib/report-family-index';
/** A short delay keeps prefetched or cached pages from flashing the skeleton. */
const SKELETON_DELAY_MS = 150;
/** In-site navigation to another report shows the report skeleton in place of the page being left,
 * until the new route renders (or the click's navigation is abandoned).
 *
 * This is client-only on purpose, instead of a loading.tsx: a route loading boundary also streams
 * on the server, which fixes the status at 200 before the page decides on notFound(), so a missing
 * channel or keyword would become a cacheable soft 404. Server HTML and statuses stay unchanged. */
export default function PendingReport({ children }: { children: ReactNode }) {
    const target = useSyncExternalStore(navigationTarget.subscribe, navigationTarget.get, () => null);
    const [show, setShow] = useState(false);
    useEffect(() => {
        if (!target || !isReportPath(target)) { setShow(false); return; }
        const timer = setTimeout(() => setShow(true), SKELETON_DELAY_MS);
        return () => clearTimeout(timer);
    }, [target]);
    // The page stays mounted (kept as is if the navigation is abandoned); `contents` adds no box.
    return <>{show && <ReportSkeleton />}<div className="contents" hidden={show}>{children}</div></>;
}
