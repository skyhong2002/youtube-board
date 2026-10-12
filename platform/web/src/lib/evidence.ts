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
