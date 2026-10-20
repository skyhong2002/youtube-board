"use client";
import { useEffect, useRef, useState } from "react";
import { reportStyle as ui } from "../lib/report-styles";
/** A cold page usually times out while the API is still computing it; that result is then cached, so a
 * short automatic re-read normally succeeds. At most two automatic tries per page per session. */
const AUTO_RETRY_SECONDS = 8, AUTO_RETRY_LIMIT = 2;
/** Shown when a public read fails with no last-good ISR page to serve (e.g. a first-load
 * 503). The failure still throws server-side so nothing is cached; the raw error and its
 * digest are never rendered. */
export default function ErrorPage({
    reset,
    retry: nextRetry,
    unstable_retry,
}: {
    error: Error & { digest?: string };
    reset?: () => void;
    /** Stable since Next 16.3 (refreshes the router, then resets the boundary). */
    retry?: () => void;
    /** Next 16.2 name for the same function. */
    unstable_retry?: () => void;
}) {
    // Server data must be re-read: prefer Next's retry, else reload instead of a client-only reset.
    const retry = nextRetry ?? unstable_retry ?? (() => (typeof window === "undefined" ? reset?.() : window.location.reload()));
    return (
        <section className="mx-auto my-8 max-w-2xl rounded-lg border border-dashed border-zinc-300 p-6 text-center sm:p-8 dark:border-zinc-700" role="alert">
            <AutoRetry retry={retry} />
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <button type="button" className={ui.primary} onClick={retry}>
                    重新讀取
                </button>
                <a className={ui.link} href="/">
                    ← 回到總覽
                </a>
            </div>
        </section>
    );
}

/** Heading, text and countdown live in their own component so ErrorPage itself stays hook-free. While an
 * automatic re-read is pending the page says it is still being prepared, so a cold first load does not
 * read as a broken site; once the automatic tries are used up it says the data cannot be read. */
function AutoRetry({ retry }: { retry: () => void }) {
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
        <div aria-live="polite">
            <h1 className="flex items-center justify-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                <span aria-hidden="true" className="inline-block size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-600 dark:border-zinc-600 dark:border-t-brand-400" />
                這一頁正在準備資料
            </h1>
            <p className="mx-auto my-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                第一次開啟、或剛更新過的頁面需要先計算，通常十幾秒內就會完成，網站沒有壞掉。
                {countdown > 0 ? `${countdown} 秒後會自動重新讀取，不用重新整理。` : "正在重新讀取⋯"}
            </p>
        </div>
    );
    return (
        <>
            <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">資料暫時無法讀取</h1>
            <p className="mx-auto my-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                目前無法確認觀測結果，請稍後重新讀取。無法讀取不代表影片、頻道或觀看數為零。
            </p>
        </>
    );
}
