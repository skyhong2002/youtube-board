"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
        <div
            className="board-actions"
            style={{ alignItems: "center", marginBottom: 16 }}
        >
            <button
                type="button"
                className="button"
                onClick={() => startTransition(() => router.refresh())}
                disabled={pending}
            >
                {pending ? "更新中…" : "更新觀測"}
            </button>
            <label
                className="muted"
                style={{
                    fontSize: 12,
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                }}
            >
                <input
                    type="checkbox"
                    checked={automatic}
                    onChange={(event) =>
                        setAutomatic(event.currentTarget.checked)
                    }
                />
                每 60 秒更新（背景分頁暫停）
            </label>
        </div>
    );
}
