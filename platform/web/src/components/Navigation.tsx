"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const links = [
    ["/", "總覽"],
    ["/live/current", "即時直播"],
    ["/ai/days", "AI 議題"],
    ["/keywords", "標籤與關鍵字"],
    ["/groups", "頻道群組"],
    ["/boards", "我的看板"],
    ["/events", "事件時間軸"],
];
export function Navigation() {
    const pathname = usePathname();
    return (
        <nav className="main-nav" aria-label="主要導覽">
            {links.map(([href, label]) => {
                const active =
                    href === "/"
                        ? pathname === "/"
                        : href === "/keywords" &&
                            ["/keywords", "/vocabulary", "/tags"].some(
                                (prefix) => pathname.startsWith(prefix),
                            )
                          ? true
                          : pathname.startsWith(
                                href.split("/").slice(0, 2).join("/"),
                            );
                return (
                    <Link
                        href={href}
                        key={href}
                        aria-current={active ? "page" : undefined}
                    >
                        {label}
                    </Link>
                );
            })}
        </nav>
    );
}
