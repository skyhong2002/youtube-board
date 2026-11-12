"use client";
import { useEffect, useRef, useState } from "react";
import { reportStyle as ui } from "../lib/report-styles";
import { StatusCard, statusSecondary } from "./StatusCard";
/** A cold page usually times out while the API is still computing it; that result is then cached, so a
 * short automatic re-read normally succeeds. At most two automatic tries per page per session. */
const AUTO_RETRY_SECONDS = 8, AUTO_RETRY_LIMIT = 2;

/** Props every Next error boundary receives; `retry` is stable since Next 16.3 and `unstable_retry`
 * is the Next 16.2 name for the same function. */
export type ErrorBoundaryProps = {
    error: Error & { digest?: string };
    reset?: () => void;
    retry?: () => void;
    unstable_retry?: () => void;
};

/** Shared body of the app's error.tsx boundaries. The raw error and its digest are never rendered.
 * `back` adds a nearer way out (a report family's listing) before the link to the home page. */
export function ErrorRecovery({ reset, retry: nextRetry, unstable_retry, back }: ErrorBoundaryProps & { back?: { href: string; label: string } | null }) {
    // Server data must be re-read: prefer Next's retry, else reload instead of a client-only reset.
    const retry = nextRetry ?? unstable_retry ?? (() => (typeof window === "undefined" ? reset?.() : window.location.reload()));
    return <AutoRetry retry={retry} actions={<>
        <button type="button" className={ui.primary} onClick={retry}>重新讀取這一頁</button>
        {back && <a className={statusSecondary} href={back.href}>回到{back.label}</a>}
        <a className={statusSecondary} href="/">回到總覽</a>
    </>} />;
}

/** Heading, text and countdown live in their own component so ErrorRecovery itself stays hook-free. While an
 * automatic re-read is pending the page says it is still being prepared, so a cold first load does not
 * read as a broken site; once the automatic tries are used up it says the data cannot be read. */
function AutoRetry({ retry, actions }: { retry: () => void; actions: React.ReactNode }) {
    const [countdown, setCountdown] = useState<number | null>(null), retryRef = useRef(retry);
    retryRef.current = retry;
    useEffect(() => {
        const key = `auto-retry:${window.location.pathname}${window.location.search}`;
        let tries = 0;
        try { tries = Number(window.sessionStorage.getItem(key) ?? 0); } catch { return; }
        if (tries >= AUTO_RETRY_LIMIT) return;
        let left = AUTO_RETRY_SECONDS;
        setCountdown(left);
        const timer = window.setInterval(() => {
            left -= 1;
            setCountdown(left);
            if (left > 0) return;
            window.clearInterval(timer);
            try { window.sessionStorage.setItem(key, String(tries + 1)); } catch { /* storage full or blocked: retry once anyway */ }
            retryRef.current();
        }, 1000);
        return () => window.clearInterval(timer);
    }, []);
    if (countdown !== null) return (
        <StatusCard heading="h1" role="status" shortcuts={false} eyebrow="資料準備中" actions={actions}
            title={<span className="inline-flex items-center justify-center gap-2"><span aria-hidden="true" className="inline-block size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-600 dark:border-zinc-600 dark:border-t-brand-400" />這一頁正在準備資料</span>}>
            <p className="m-0" aria-live="polite">
                第一次開啟、或剛更新過的頁面需要先計算，通常十幾秒內就會完成，網站沒有壞掉。
                {countdown > 0 ? `${countdown} 秒後會自動重新讀取，不用重新整理。` : "正在重新讀取⋯"}
            </p>
        </StatusCard>
    );
    return (
        <StatusCard heading="h1" eyebrow="暫時無法連線到資料" title="資料暫時無法讀取" actions={actions}>
            <p className="m-0">這一頁需要的觀測資料目前讀不到，通常幾秒到幾分鐘內就會恢復。無法讀取不代表影片、頻道或觀看數為零。</p>
        </StatusCard>
    );
}
