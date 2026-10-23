"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
/** Live observations re-read every 60 seconds while the tab is visible; a quiet inline control beside the summary. */
export function RefreshControl() {
    const router = useRouter();
    const [automatic, setAutomatic] = useState(true);
    const [pending, startTransition] = useTransition();
    useEffect(() => {
        if (!automatic) return;
        const interval = setInterval(() => {
            if (document.visibilityState === "visible")
                startTransition(() => router.refresh());
        }, 60000);
        return () => clearInterval(interval);
    }, [automatic, router]);
    return (
        <span className="inline-flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <label className="inline-flex cursor-pointer items-center gap-1.5" title="切到其他分頁時暫停，回來後繼續">
                <input type="checkbox" className="accent-brand-700" checked={automatic} onChange={(event) => setAutomatic(event.currentTarget.checked)} />
                每 60 秒自動更新
            </label>
            <button type="button" className="text-brand-700 underline-offset-2 hover:underline disabled:text-zinc-400 dark:text-brand-400" onClick={() => startTransition(() => router.refresh())} disabled={pending}>
                {pending ? "更新中…" : "立即更新"}
            </button>
        </span>
    );
}
