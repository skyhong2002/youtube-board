/** Minimum shape VideoTagEvidence renders; anything else shows its unavailable note
 * instead of failing the whole video page. */
export function tagEvidenceRenderable(data: unknown): boolean {
    if (!data || typeof data !== "object") return false;
    const rows = (data as { rows?: unknown }).rows;
    return Array.isArray(rows) && rows.every((row) =>
        !!row && typeof row === "object" &&
        typeof (row as { term?: unknown }).term === "string" &&
        typeof (row as { snippet?: unknown }).snippet === "string" &&
        typeof (row as { text?: unknown }).text === "string");
}
export function splitEvidence(evidence: {
    snippet: string;
    snippetStart: number;
    start: number;
    end: number;
    text: string;
}) {
    const start = evidence.start - evidence.snippetStart;
    const end = evidence.end - evidence.snippetStart;
    if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        end > evidence.snippet.length ||
        evidence.snippet.slice(start, end) !== evidence.text
    )
        return { before: evidence.snippet, match: "", after: "" };
    return {
        before: evidence.snippet.slice(0, start),
        match: evidence.snippet.slice(start, end),
        after: evidence.snippet.slice(end),
    };
}
