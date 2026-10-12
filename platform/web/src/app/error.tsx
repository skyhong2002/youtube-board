"use client";
import { reportStyle as ui } from "../lib/report-styles";
/** Shown when a public read fails with no last-good ISR page to serve (e.g. a first-load
 * 503). The failure still throws server-side so nothing is cached; the raw error and its
 * digest are never rendered. */
export default function ErrorPage({
    reset,
    unstable_retry,
}: {
    error: Error & { digest?: string };
    reset?: () => void;
    unstable_retry?: () => void;
}) {
    // Server data must be re-read: prefer Next's retry, else reload instead of a client-only reset.
    const retry = unstable_retry ?? (() => (typeof window === "undefined" ? reset?.() : window.location.reload()));
    return (
        <section className="mx-auto my-8 max-w-2xl rounded-lg border border-dashed border-zinc-300 p-6 text-center sm:p-8 dark:border-zinc-700" role="alert">
            <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">資料暫時無法讀取</h1>
            <p className="mx-auto my-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                目前無法確認觀測結果，請稍後重新讀取。無法讀取不代表影片、頻道或觀看數為零。
            </p>
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
