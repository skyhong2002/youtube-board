"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
    BOARD_STORAGE_KEY,
    boardUrl,
    SEARCH_MAX_LENGTH,
    BOARD_KEYWORD_MAX,
    normalizeChannelIds,
    parseBoardRequest,
    parseBoards,
    updateBoards,
    type Board,
    type BoardDraft,
} from "@/lib/boards";
export function BoardEditor({ initial, pickers }: { initial: BoardDraft; pickers: ReactNode }) {
    const [boards, setBoards] = useState<Board[]>([]);
    const [ready, setReady] = useState(false);
    const [message, setMessage] = useState("");
    const [shareUrl, setShareUrl] = useState("");
    useEffect(() => {
        const refresh = () => {
            try {
                const result = parseBoards(
                    localStorage.getItem(BOARD_STORAGE_KEY),
                );
                setBoards(result.boards);
                if (!result.writable)
                    setMessage(
                        "部分收藏無法完整讀取。為保留原資料，目前暫停修改；已有看板仍可開啟與分享。",
                    );
            } catch {
                setMessage("此瀏覽器無法儲存收藏。");
            }
        };
        const sync = (event: StorageEvent) => {
            if (event.key === BOARD_STORAGE_KEY || event.key === null)
                refresh();
        };
        refresh();
        setReady(true);
        window.addEventListener("storage", sync);
        return () => window.removeEventListener("storage", sync);
    }, []);
    function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const input = new URLSearchParams();
        for (const [key, value] of data) input.append(key, String(value));
        const parsed = parseBoardRequest(input);
        if (!parsed) {
            setMessage("篩選條件無效。請確認分類、日期先後與文字長度；原有收藏已保留。");
            return;
        }
        if (boards.length >= 50) {
            setMessage("最多可以收藏 50 個看板，請先移除不需要的收藏。");
            return;
        }
        const board: Board = {
            ...parsed.board,
            id: globalThis.crypto?.randomUUID?.() ??
                `board-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: parsed.board.name.trim() || "我的看板",
        };
        try {
            const next = updateBoards(
                localStorage.getItem(BOARD_STORAGE_KEY),
                (current) => {
                    if (current.length >= 50) throw new Error("BOARD_LIMIT");
                    return [...current, board];
                },
            );
            localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(next));
            setBoards(next);
            setMessage("看板已儲存於此瀏覽器。");
        } catch {
            setShareUrl(new URL(boardUrl(board), window.location.origin).href);
            setMessage(
                "無法更新收藏，原有資料已保留。可複製下方網址保留這個看板。",
            );
        }
    }
    function remove(id: string) {
        try {
            const next = updateBoards(
                localStorage.getItem(BOARD_STORAGE_KEY),
                (current) => current.filter((board) => board.id !== id),
            );
            localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(next));
            setBoards(next);
            setMessage("已移除本機收藏。");
        } catch {
            setMessage("無法更新收藏，原有資料已保留。");
        }
    }
    async function share(board: Board) {
        const url = new URL(boardUrl(board), window.location.origin).href;
        setShareUrl(url);
        if (!window.isSecureContext || !navigator.clipboard) {
            setMessage(
                "請選取並複製下方分享網址。網址包含看板名稱與篩選條件。",
            );
            return;
        }
        try {
            await navigator.clipboard.writeText(url);
            setMessage("已複製分享網址。網址會包含看板名稱與篩選條件。");
        } catch {
            setMessage("請選取並複製下方分享網址。");
        }
    }
    return (
        <div className="split">
            <section>
                <h2>已收藏看板</h2>
                {ready && !boards.length && (
                    <div className="empty-state">
                        <h3>建立自己的觀測範圍</h3>
                        <p>選擇頻道、分類、日期與共同標籤，保存常用的觀測範圍。</p>
                    </div>
                )}
                <div className="board-list">
                    {boards.map((board) => (
                        <article className="board-item" key={board.id}>
                            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                                <h3 style={{ marginBottom: 4 }}>
                                    <Link href={boardUrl(board)}>
                                        {board.name}
                                    </Link>
                                </h3>
                                <small>
                                    {board.channelIds
                                        ? `${normalizeChannelIds(board.channelIds)?.split(",").length ?? 0} 個頻道`
                                        : "全部觀測頻道"}
                                    {board.keyword && ` · 共同標籤：${board.keyword}`}
                                    {board.query && ` · 文字：${board.query}`}
                                    {(board.tagid || board.or || board.not) && " · 已設頻道分類"}
                                    {(board.from || board.to) && ` · ${board.from || "不限起日"}～${board.to || "不限迄日"}`}
                                </small>
                            </div>
                            <div className="board-actions">
                                <Link className="button" href={boardUrl(board)}>
                                    開啟
                                </Link>
                                <button
                                    className="button"
                                    onClick={() => share(board)}
                                >
                                    分享
                                </button>
                                <button
                                    className="button"
                                    onClick={() => remove(board.id)}
                                    aria-label={`移除 ${board.name} 的收藏`}
                                >
                                    移除
                                </button>
                            </div>
                        </article>
                    ))}
                </div>
            </section>
            <section className="panel">
                <h2>新增看板</h2>
                <form className="board-editor" onSubmit={save}>
                    <label>
                        看板名稱
                        <input
                            name="name"
                            defaultValue={initial.name}
                            required
                            maxLength={80}
                            placeholder="例如：地方新聞觀測"
                        />
                    </label>
                    {pickers}
                    <small>每組最多選擇 20 項；分類條件會與來源頻道、日期及文字條件同時套用。</small>
                    <label>
                        共同標籤（新文易數）
                        <input name="keyword" maxLength={BOARD_KEYWORD_MAX} defaultValue={initial.keyword || ""} placeholder="請使用共同詞彙中的完整標籤名稱" />
                    </label>
                    <small><Link href="/vocabulary">瀏覽共同詞彙</Link>並選擇標籤建立看板。依目前版本的影片標題與描述比對；不等同頻道分類。</small>
                    <label>
                        影片文字搜尋
                        <input name="q" maxLength={SEARCH_MAX_LENGTH} defaultValue={initial.query} placeholder="搜尋標題與描述，最多 100 字" />
                    </label>
                    <label>
                        發布起日（台北時間）
                        <input name="from" type="date" defaultValue={initial.from || ""} />
                    </label>
                    <label>
                        發布迄日（含當日）
                        <input name="to" type="date" defaultValue={initial.to || ""} />
                    </label>
                    <button
                        type="submit"
                        className="button button-primary"
                        disabled={!ready}
                    >
                        建立並收藏
                    </button>
                </form>
                <p style={{ fontSize: 11, marginTop: 14, marginBottom: 0 }}>
                    收藏僅儲存在目前瀏覽器。分享網址包含名稱與篩選條件，不包含登入資訊。
                </p>
            </section>
            <div style={{ gridColumn: "1 / -1" }}>
                <p
                    role="status"
                    style={{ overflowWrap: "anywhere", fontSize: 12 }}
                >
                    {message}
                </p>
                {shareUrl && (
                    <label className="board-editor">
                        分享網址
                        <input
                            aria-label="分享網址"
                            readOnly
                            value={shareUrl}
                            onFocus={(event) => event.currentTarget.select()}
                        />
                    </label>
                )}
            </div>
        </div>
    );
}
