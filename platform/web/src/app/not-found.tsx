import Link from "next/link";
export default function NotFound() {
    return (
        <section className="empty-state">
            <p className="eyebrow">404</p>
            <h1>找不到這個頁面</h1>
            <p>網址可能已變更，或這筆資料尚未收錄。</p>
            <Link className="button" href="/">
                回到總覽
            </Link>
        </section>
    );
}
