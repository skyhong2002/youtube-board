"use client";
export default function ErrorPage({
    reset,
}: {
    error: Error;
    reset: () => void;
}) {
    return (
        <section className="empty-state" role="alert">
            <h1>暫時無法顯示這份報表</h1>
            <p>請稍後重新讀取。</p>
            <button className="button" onClick={reset}>
                重新讀取
            </button>
        </section>
    );
}
