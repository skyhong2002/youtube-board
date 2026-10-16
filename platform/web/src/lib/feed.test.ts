import { strict as assert } from "node:assert";
import { test } from "node:test";
import { videoFeed, xml } from "./feed";
import type { VideoRow } from "../../../api/src/contracts";
test("RSS escapes source text and preserves original video identity and observation date", () => {
    const row = {
        id: "AbCdEfGh123",
        title: 'A & B <標題> "聲明"',
        channelTitle: "測試頻道",
        description: "文字 <script> & 內容",
        youtubeUrl: "https://www.youtube.com/watch?v=AbCdEfGh123",
        publishedAt: "2026-10-09T16:00:00.000Z",
    } as VideoRow;
    const feed = videoFeed({
        rows: [row],
        title: "觀測",
        link: "https://example.test/boards/view?q=A&B",
        updatedAt: "2026-10-10T16:00:00.000Z",
        fixture: true,
    });
    assert.ok(feed.includes("A &amp; B &lt;標題&gt; &quot;聲明&quot;"));
    assert.ok(feed.includes("youtube:AbCdEfGh123"));
    assert.ok(
        feed.includes("<pubDate>Fri, 09 Oct 2026 16:00:00 GMT</pubDate>"),
    );
    assert.ok(
        feed.includes(
            "<lastBuildDate>Sat, 10 Oct 2026 16:00:00 GMT</lastBuildDate>",
        ),
    );
    assert.ok(feed.includes("開發驗證資料"));
    assert.ok(feed.includes("一頁 YouTube 影片，最多 100 部"));
    assert.ok(!feed.includes("<script>"));
});
test("RSS does not fabricate a build date when source observation time is unknown", () => {
    assert.equal(
        videoFeed({
            rows: [],
            title: "test",
            link: "https://example.test",
            updatedAt: null,
            fixture: false,
        }).includes("lastBuildDate"),
        false,
    );
    assert.equal(xml("a\u0000b\u0008c"), "abc");
});
test("RSS origin is configured in production and only allowed development hosts can be reflected", async () => {
    const { feedOrigin } = await import("./feed");
    assert.equal(
        feedOrigin(
            undefined,
            true,
            "http://internal:3100",
            "unexpected.example",
            [],
        ),
        null,
    );
    assert.equal(
        feedOrigin(
            "https://youtube.observe.tw",
            true,
            "http://internal:3100",
            "unexpected.example",
            [],
        ),
        "https://youtube.observe.tw",
    );
    assert.equal(
        feedOrigin(
            undefined,
            false,
            "http://0.0.0.0:3100",
            "100.85.214.25:3100",
            ["100.85.214.25"],
        ),
        "http://100.85.214.25:3100",
    );
    assert.equal(
        feedOrigin(
            undefined,
            false,
            "http://0.0.0.0:3100",
            "unexpected.example",
            ["100.85.214.25"],
        ),
        null,
    );
    assert.equal(xml("a\ufffeb\uffffc"), "abc");
});
