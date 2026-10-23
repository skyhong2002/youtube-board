"use client";
import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { count } from "@/lib/format";

/** Grows the list as the reader nears its end: `next` is the same page with a larger limit, built on the server. */
export function ScrollMore({ next, shown, total, unit }: { next?: string; shown: number; total: number | null; unit: string }) {
    const router = useRouter();
    const sentinel = useRef<HTMLDivElement>(null);
    const [pending, startTransition] = useTransition();
    useEffect(() => {
        const node = sentinel.current;
        if (!next || pending || !node) return;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            startTransition(() => router.replace(next, { scroll: false }));
        }, { rootMargin: "600px 0px" });
        observer.observe(node);
        return () => observer.disconnect();
    }, [next, pending, router]);
    if (shown === 0) return null;
    return <div ref={sentinel} className="my-4 text-center text-sm text-zinc-500 dark:text-zinc-400" aria-live="polite">
        {next
            ? <a href={next} onClick={(event) => { event.preventDefault(); startTransition(() => router.replace(next, { scroll: false })); }} className="underline-offset-2 hover:underline">
                {pending ? "載入中…" : `已顯示 ${count(shown)}${total === null ? "" : ` / ${count(total)}`} ${unit}，往下捲動載入更多`}
            </a>
            : total !== null && shown >= total && `已顯示全部 ${count(total)} ${unit}`}
    </div>;
}
