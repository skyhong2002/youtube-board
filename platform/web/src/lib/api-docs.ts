/** Structured view of the generated platform/docs/api.md (tools/gen-api-docs.ts), so /api
 * shows the same single-source catalog as the OpenAPI document without a hand-kept
 * endpoint list. Pure: no fs, no React, no HTML. Only the Markdown subset the generator
 * emits is recognised; anything else stays plain text and React escapes it, so raw HTML
 * in the source can never reach the page as markup. */
export type DocBlock =
    | { kind: 'paragraph'; text: string }
    | { kind: 'list'; items: string[] }
    | { kind: 'code'; lang: string; code: string }
    | { kind: 'table'; head: string[]; rows: string[][] };
export interface DocSection { id: string; title: string; blocks: DocBlock[]; children: DocSection[] }
export interface ApiDocument { title: string; intro: DocBlock[]; sections: DocSection[] }
export type InlinePart = { code: boolean; text: string };

/** Split a table row on unescaped pipes; `\|` stays a literal pipe inside the cell. */
export function tableCells(line: string): string[] {
    const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
    return body.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll('\\|', '|'));
}
const separator = (line: string) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim());
/** Backtick spans become code parts; everything else is literal text. */
export function inlineParts(text: string): InlinePart[] {
    return text.split(/(`[^`]+`)/).filter(Boolean).map((part) =>
        part.length > 1 && part.startsWith('`') && part.endsWith('`') ? { code: true, text: part.slice(1, -1) } : { code: false, text: part });
}
export const plainText = (text: string) => inlineParts(text).map((part) => part.text).join('');
/** Unicode-aware so the generator's Chinese headings keep readable, stable anchors. */
const slug = (title: string) => plainText(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
/** H2 titles the generator always emits; the loader rejects a document missing either. */
export const API_DOCS_RULES_TITLE = '使用規則';
export const API_DOCS_CATALOG_TITLE = '端點一覽';

export function parseApiDocs(markdown: string): ApiDocument {
    const lines = markdown.replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').split('\n');
    const used = new Map<string, number>();
    const unique = (title: string) => {
        const base = slug(title), count = (used.get(base) ?? 0) + 1;
        used.set(base, count);
        return count === 1 ? base : `${base}-${count}`;
    };
    const doc: ApiDocument = { title: '', intro: [], sections: [] };
    let h2: DocSection | null = null, h3: DocSection | null = null;
    const target = () => (h3 ?? h2)?.blocks ?? doc.intro;
    for (let i = 0; i < lines.length;) {
        const line = lines[i]!;
        const fence = line.match(/^```\s*([\w-]*)\s*$/);
        if (fence) {
            const code: string[] = [];
            for (i++; i < lines.length && !/^```\s*$/.test(lines[i]!); i++) code.push(lines[i]!);
            i++;
            target().push({ kind: 'code', lang: fence[1] ?? '', code: code.join('\n') });
            continue;
        }
        const heading = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
        if (heading) {
            const level = heading[1]!.length, title = heading[2]!;
            if (level === 1 && !doc.title) doc.title = title;
            else if (level === 2 || (level === 3 && !h2)) { h2 = { id: unique(title), title, blocks: [], children: [] }; h3 = null; doc.sections.push(h2); }
            else if (level === 3 && h2) { h3 = { id: unique(title), title, blocks: [], children: [] }; h2.children.push(h3); }
            else target().push({ kind: 'paragraph', text: title });
            i++;
            continue;
        }
        if (line.trim().startsWith('|') && i + 1 < lines.length && separator(lines[i + 1]!)) {
            const head = tableCells(line), rows: string[][] = [];
            for (i += 2; i < lines.length && lines[i]!.trim().startsWith('|'); i++) rows.push(tableCells(lines[i]!));
            target().push({ kind: 'table', head, rows });
            continue;
        }
        if (/^\s*[-*]\s+/.test(line)) {
            const items: string[] = [];
            for (; i < lines.length && /^\s*[-*]\s+/.test(lines[i]!); i++) items.push(lines[i]!.replace(/^\s*[-*]\s+/, '').trim());
            target().push({ kind: 'list', items });
            continue;
        }
        if (!line.trim()) { i++; continue; }
        const text: string[] = [];
        for (; i < lines.length && lines[i]!.trim() && !/^(```|#{1,3}\s|\s*[-*]\s+|\s*\|)/.test(lines[i]!); i++) text.push(lines[i]!.trim());
        if (!text.length) { target().push({ kind: 'paragraph', text: line.trim() }); i++; continue; }
        target().push({ kind: 'paragraph', text: text.join(' ') });
    }
    return doc;
}

/** OpenAPI `{id}` form for a catalog path; the status endpoint list may use `:id`. */
export const openApiPath = (path: string) => path.replace(/:([A-Za-z]+)/g, '{$1}');
/** path → summary from the generated endpoint catalog table (method + path key). */
export function endpointSummaries(doc: ApiDocument): Map<string, string> {
    const section = doc.sections.find((s) => s.title === API_DOCS_CATALOG_TITLE);
    const tableBlock = section?.blocks.find((b): b is Extract<DocBlock, { kind: 'table' }> => b.kind === 'table');
    const result = new Map<string, string>();
    if (!tableBlock) return result;
    const at = (name: string) => tableBlock.head.findIndex((h) => h.toLowerCase() === name);
    const method = at('method'), path = at('path'), summary = at('summary');
    if (method < 0 || path < 0 || summary < 0) return result;
    for (const row of tableBlock.rows) result.set(`${plainText(row[method] ?? '')} ${plainText(row[path] ?? '')}`, plainText(row[summary] ?? ''));
    return result;
}
