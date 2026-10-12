import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeChannelIds, boardUrl, readBoards } from "./boards";
test("board filters retain distinct channel IDs and reject invalid/unbounded input", () => {
    assert.equal(normalizeChannelIds("12, 23，12"), "12,23");
    assert.equal(normalizeChannelIds(""), "");
    assert.equal(normalizeChannelIds("1,not-a-number"), null);
    assert.equal(normalizeChannelIds("-1"), null);
    assert.equal(normalizeChannelIds("，， ,"), null);
    assert.equal(
        normalizeChannelIds(
            Array.from({ length: 21 }, (_, i) => i + 1).join(","),
        ),
        null,
    );
});
test("share URLs encode the user label and query without introducing extra parameters", () => {
    const path = boardUrl({
        name: "台灣 & 國際",
        channelIds: "12,23",
        query: "地方新聞&admin=1",
    });
    const url = new URL(path, "https://example.test");
    assert.equal(url.pathname, "/boards/view");
    assert.equal(url.searchParams.get("q"), "地方新聞&admin=1");
    assert.equal(url.searchParams.has("admin"), false);
});
test("corrupt or incompatible local storage cannot be treated as a valid board", () => {
    const valid = { id: "a", name: "地方", channelIds: "12", query: "新聞" };
    assert.deepEqual(readBoards("not json"), []);
    assert.deepEqual(
        readBoards(
            JSON.stringify([valid, { ...valid, channelIds: "invalid" }, null]),
        ),
        [valid],
    );
    assert.deepEqual(readBoards(JSON.stringify({ boards: [valid] })), []);
});

test("partial or duplicate stored data remains readable but cannot be silently overwritten", async () => {
    const { parseBoards, updateBoards } = await import("./boards");
    const valid = { id: "a", name: "地方", channelIds: "12", query: "新聞" };
    const raw = JSON.stringify([valid, { ...valid, name: "另一看板" }]);
    assert.equal(parseBoards(raw).boards.length, 1);
    assert.equal(parseBoards(raw).writable, false);
    assert.throws(() => updateBoards(raw, () => []), /INVALID_STORED_BOARDS/);
    assert.throws(
        () => updateBoards("not json", () => []),
        /INVALID_STORED_BOARDS/,
    );
});

test("oversized saved collections stay readable without discarding the unshown original entries", async () => {
    const { parseBoards, updateBoards } = await import("./boards");
    const entries = Array.from({ length: 51 }, (_, index) => ({
        id: `preserved-${index}`, name: `看板 ${index}`, channelIds: "12", query: "",
    }));
    const raw = JSON.stringify(entries);
    const parsed = parseBoards(raw);
    assert.deepEqual(parsed.boards, entries.slice(0, 50));
    assert.equal(parsed.writable, false);
    let invoked = false;
    assert.throws(() => updateBoards(raw, () => { invoked = true; return []; }), /INVALID_STORED_BOARDS/);
    assert.equal(invoked, false);
    assert.equal(JSON.parse(raw).length, 51);
});

test("mutations can merge the latest storage instead of stale component state", async () => {
    const { updateBoards } = await import("./boards");
    const first = { id: "a", name: "第一", channelIds: "12", query: "" };
    const second = { id: "b", name: "第二", channelIds: "23", query: "" };
    assert.deepEqual(
        updateBoards(JSON.stringify([first]), (current) => [
            ...current,
            second,
        ]),
        [first, second],
    );
    assert.deepEqual(
        updateBoards(JSON.stringify([first, second]), (current) =>
            current.filter((b) => b.id !== first.id),
        ),
        [second],
    );
});

test("board queries use the API limit and never silently truncate shared filters", () => {
    const valid = { id: "a", name: "查詢", channelIds: "", query: "字".repeat(100) };
    assert.equal(new URL(boardUrl(valid), "http://localhost").searchParams.get("q"), valid.query);
    assert.throws(() => boardUrl({ ...valid, query: valid.query + "字" }), /SEARCH_TOO_LONG/);
    assert.deepEqual(readBoards(JSON.stringify([{ ...valid, query: valid.query + "字" }])), []);
});

test("one scope roundtrips through storage, shared links, pagination and RSS without sending name as an API filter", async () => {
    const { parseBoardRequest, boardSearch, boardApiQuery, boardFeedUrl, parseBoards } = await import("./boards");
    const board = { name: "台灣 & 地方", channelIds: "12,23", query: "交通 & News", tagid: "2,5", or: "8,10", not: "13", from: "2026-09-01", to: "2026-10-12", keyword: "AI／ＡＩ e\u0301 & 臺灣" };
    const expected = { channelIds: board.channelIds, q: board.query, tagid: board.tagid, or: board.or, not: board.not, from: board.from, to: board.to, keyword: board.keyword };
    for (const path of [boardUrl(board), boardFeedUrl(board)]) {
        const url = new URL(path, "https://example.test");
        assert.deepEqual(parseBoardRequest(url.searchParams), { board, offset: 0 });
        assert.deepEqual(boardApiQuery(parseBoardRequest(url.searchParams)!.board, 100), { ...expected, limit: "100" });
    }
    const nextPage = new URLSearchParams({ ...boardSearch(board), offset: "50" });
    assert.deepEqual(parseBoardRequest(nextPage), { board, offset: 50 });
    assert.deepEqual(boardApiQuery(board, 50, 50), { ...expected, limit: "50", offset: "50" });
    const saved = { id: "scoped", ...board };
    assert.deepEqual(parseBoards(JSON.stringify([saved])), { boards: [saved], writable: true });
});

test("shared board, form and RSS parsing reject malformed, duplicate and widening scope", async () => {
    const { parseBoardRequest } = await import("./boards");
    const invalid = [
        "channelIds=12&channelIds=12", "tagid=2&tagid=3", "q=x&q=x", "keyword=AI&keyword=ai", "name=a&name=b", "from=2026-10-01&from=2026-10-01",
        "tagid=2,invalid", "or=0", "not=-2", "tagid=" + Array.from({ length: 21 }, (_, i) => i + 1).join(","),
        "from=2026-02-30", "to=2026-13-01", "from=2026-10-12&to=2026-10-01", "from=2026-10-1", "to=tomorrow",
        "offset=", "offset=-1", "offset=100001", "offset=50&offset=50", "channelId=23", "sort=viewCount", "unknown=1", "limit=500",
        "q=" + "x".repeat(101), "keyword=" + "詞".repeat(241), "name=" + "名".repeat(81),
    ];
    for (const query of invalid) assert.equal(parseBoardRequest(new URLSearchParams(query)), null, query);
    assert.equal(parseBoardRequest({ channelIds: ["12", "23"] }), null);
    assert.equal(parseBoardRequest({ keyword: 123 }), null);
    assert.deepEqual(parseBoardRequest(new URLSearchParams("name=&q=&tagid=&from=&to=&keyword=&_rsc=transport")), { board: { name: "", channelIds: "", query: "" }, offset: 0 });
    assert.equal(parseBoardRequest({ from: "2024-02-29", keyword: "AI" })?.board.keyword, "AI");
    assert.equal(parseBoardRequest({ keyword: " ai " })?.board.keyword, " ai ");
});

test("old v1 board storage and URLs remain readable and optional malformed fields preserve the original storage", async () => {
    const { parseBoards, parseBoardRequest, updateBoards } = await import("./boards");
    const old = { id: "old", name: "舊收藏", channelIds: "12，23 12", query: "地方" };
    assert.deepEqual(parseBoards(JSON.stringify([old])), { boards: [old], writable: true });
    assert.equal(parseBoardRequest(new URL(boardUrl(old), "http://localhost").searchParams)?.board.channelIds, "12,23");
    assert.deepEqual(parseBoardRequest(new URLSearchParams("channelIds=12&q=news")), { board: { name: "", channelIds: "12", query: "news" }, offset: 0 });
    for (const extra of [{ from: "2026-02-30" }, { keyword: ["AI"] }, { or: "bad" }, { futureFilter: "news" }]) {
        const raw = JSON.stringify([old, { ...old, id: "new", ...extra }]);
        assert.deepEqual(parseBoards(raw), { boards: [old], writable: false });
        assert.throws(() => updateBoards(raw, () => []), /INVALID_STORED_BOARDS/);
    }
});

test("board request status rejects invalid scope before streaming a success page", async () => {
    const { reportRequestStatus } = await import("./request-status");
    for (const query of ["tagid=oops", "keyword=AI&keyword=ai", "from=2026-10-12&to=2026-10-01", "channelIds=1&channelIds=2", "q=" + "x".repeat(101)]) {
        assert.equal(reportRequestStatus(new URL("https://example.test/boards/view?" + query))?.status, 400);
    }
    assert.equal(reportRequestStatus(new URL("https://example.test/boards/view?keyword=AI&tagid=2&from=2026-10-01&offset=50")), null);
    assert.equal(reportRequestStatus(new URL("https://example.test/boards?from=2026-10-12&to=2026-10-01"))?.status, 400);
    assert.equal(reportRequestStatus(new URL("https://example.test/boards?keyword=AI&tagid=2&_rsc=transport")), null);
});
