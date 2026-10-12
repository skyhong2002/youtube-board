import { strict as assert } from "node:assert";
import { test } from "node:test";
import { splitEvidence } from "./evidence";
test("evidence highlights original UTF-16 offsets without corrupting astral characters", () => {
    assert.deepEqual(
        splitEvidence({
            snippet: "🎥今天談台灣新聞",
            snippetStart: 0,
            start: 5,
            end: 7,
            text: "台灣",
        }),
        { before: "🎥今天談", match: "台灣", after: "新聞" },
    );
});
test("stale or malformed evidence never highlights a different word", () => {
    assert.deepEqual(
        splitEvidence({
            snippet: "新的影片標題",
            snippetStart: 0,
            start: 0,
            end: 2,
            text: "台灣",
        }),
        { before: "新的影片標題", match: "", after: "" },
    );
});
