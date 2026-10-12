import { strict as assert } from "node:assert";
import { test } from "node:test";
import { compareTitles } from "./headline";
import { safeReportHref } from "./report-contract";
test("wording comparison preserves every source character including emoji", () => {
    const left = "🎥市長提出新計畫",
        right = "📹市長回應新計畫";
    const result = compareTitles(left, right)!;
    assert.equal(result.left.map((piece) => piece.text).join(""), left);
    assert.equal(result.right.map((piece) => piece.text).join(""), right);
    assert.equal(
        result.left
            .filter((piece) => piece.shared)
            .map((piece) => piece.text)
            .join(""),
        "市長新計畫",
    );
    assert.equal(
        result.right
            .filter((piece) => piece.shared)
            .map((piece) => piece.text)
            .join(""),
        "市長新計畫",
    );
});
test("long comparison input is bounded without silently truncating displayed source text", () => {
    assert.equal(compareTitles("a".repeat(501), "b"), null);
    assert.deepEqual(compareTitles("", ""), { left: [], right: [] });
});
test("report links support local and HTTPS sources but reject executable or ambiguous destinations", () => {
    assert.equal(safeReportHref("/channels/12"), "/channels/12");
    assert.equal(
        safeReportHref("https://tag.observe.tw/tag/新聞"),
        "https://tag.observe.tw/tag/%E6%96%B0%E8%81%9E",
    );
    for (const href of [
        "//example.test",
        "javascript:alert(1)",
        "/\\example.test",
        "https://user:pass@example.test",
        "/foo\nbar",
    ])
        assert.equal(safeReportHref(href), undefined);
});
