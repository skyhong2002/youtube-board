import { SEARCH_MAX_LENGTH } from '../../../shared/report-limits';
import { selectedFilterIds, FILTER_OPTION_LIMIT } from '../../../shared/filter-options';
export { SEARCH_MAX_LENGTH };
export const BOARD_KEYWORD_MAX = 240;
export const BOARD_SCOPE_KEYS = ['tagid', 'or', 'not', 'from', 'to', 'keyword'] as const;
export interface BoardScope {
    channelIds: string;
    query: string;
    tagid?: string;
    or?: string;
    not?: string;
    from?: string;
    to?: string;
    keyword?: string;
}
export interface Board extends BoardScope { id: string; name: string }
export type BoardDraft = Omit<Board, 'id'>;
export type BoardSearch = Record<string, unknown>;
export const BOARD_STORAGE_KEY = 'youtube-board.boards.v1';

/** Keep the original v1 comma/space/full-width-comma channel syntax readable. */
export function normalizeChannelIds(value: string): string | null {
    if (value.length > 256) return null;
    if (!value.trim()) return '';
    const ids = value.split(/[\s,，]+/).filter(Boolean);
    if (!ids.length || ids.length > 20 || ids.some(id => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1)) return null;
    return [...new Set(ids.map(id => String(Number(id))))].join(',');
}
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** One parser for creation, shared URLs, video reads, pagination and RSS.
 * Repeated scalar parameters stay invalid even when they repeat the same value. */
export function parseBoardRequest(input: BoardSearch | URLSearchParams): { board: BoardDraft; offset: number } | null {
    const raw: BoardSearch = Object.create(null);
    if (input instanceof URLSearchParams) {
        for (const key of new Set(input.keys())) {
            const values = input.getAll(key);
            raw[key] = values.length === 1 ? values[0] : values;
        }
    } else Object.assign(raw, input);
    const allowed = new Set(['name', 'channelIds', 'q', ...BOARD_SCOPE_KEYS, 'offset', '_rsc']);
    if (Object.keys(raw).some(key => !allowed.has(key))) return null;
    for (const [key, value] of Object.entries(raw)) {
        if (key !== '_rsc' && value !== undefined && typeof value !== 'string') return null;
    }
    const value = (key: string) => raw[key] as string | undefined;
    const name = value('name') ?? '', query = value('q') ?? '';
    const channelIds = normalizeChannelIds(value('channelIds') ?? '');
    if (name.length > 80 || query.length > SEARCH_MAX_LENGTH || channelIds === null) return null;
    const board: BoardDraft = { name, channelIds, query };
    for (const key of ['tagid', 'or', 'not'] as const) {
        const selection = value(key);
        if (selection) {
            const ids = selectedFilterIds(selection);
            if (ids === null || ids.length > FILTER_OPTION_LIMIT) return null;
            board[key] = ids.join(',');
        }
    }
    for (const key of ['from', 'to'] as const) {
        const date = value(key);
        if (date) {
            if (!validDate(date)) return null;
            board[key] = date;
        }
    }
    if (board.from && board.to && board.from > board.to) return null;
    const keyword = value('keyword');
    if (keyword) {
        if (keyword.length > BOARD_KEYWORD_MAX) return null;
        // Exact upstream label: no trimming, case folding or Unicode normalization.
        board.keyword = keyword;
    }
    const offset = raw.offset === undefined ? 0 : typeof raw.offset === 'string' && /^\d+$/.test(raw.offset) ? Number(raw.offset) : NaN;
    return Number.isSafeInteger(offset) && offset >= 0 && offset <= 100000 ? { board, offset } : null;
}

export function boardSearch(board: BoardDraft): Record<string, string> {
    const raw: Record<string, string> = { name: board.name, channelIds: board.channelIds, q: board.query };
    for (const key of BOARD_SCOPE_KEYS) if (board[key] !== undefined) raw[key] = board[key]!;
    const parsed = parseBoardRequest(raw);
    if (!parsed) throw new Error(board.query.length > SEARCH_MAX_LENGTH ? 'SEARCH_TOO_LONG' : 'INVALID_BOARD_SCOPE');
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...parsed.board, q: parsed.board.query })) {
        if (key !== 'query' && value) out[key] = value;
    }
    return out;
}
export function boardUrl(board: BoardDraft) { return '/boards/view?' + new URLSearchParams(boardSearch(board)); }
export function boardFeedUrl(board: BoardDraft) { return '/feeds/videos.xml?' + new URLSearchParams(boardSearch(board)); }
export function boardApiQuery(board: BoardDraft, limit: 50 | 100, offset = 0): Record<string, string> {
    const { name: _name, ...scope } = boardSearch(board);
    return { ...scope, limit: String(limit), ...(offset ? { offset: String(offset) } : {}) };
}

export interface BoardRead { boards: Board[]; writable: boolean }
export function parseBoards(raw: string | null): BoardRead {
    if (raw === null) return { boards: [], writable: true };
    if (raw.length > 100000) return { boards: [], writable: false };
    try {
        const decoded: unknown = JSON.parse(raw);
        if (!Array.isArray(decoded)) return { boards: [], writable: false };
        const seen = new Set<string>(), allowed = new Set(['id', 'name', 'channelIds', 'query', ...BOARD_SCOPE_KEYS]);
        const boards = decoded.filter((item): item is Board => {
            if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || item.id.length > 100 || seen.has(item.id) || typeof item.name !== 'string' || typeof item.channelIds !== 'string' || typeof item.query !== 'string' || Object.keys(item).some(k => !allowed.has(k))) return false;
            const { id: _id, query, ...rest } = item;
            if (!parseBoardRequest({ ...rest, q: query })) return false;
            seen.add(item.id);
            return true;
        }).slice(0, 50);
        // Retain original v1 objects; invalid or future fields must not be overwritten.
        return { boards, writable: boards.length === decoded.length };
    } catch { return { boards: [], writable: false }; }
}
export function readBoards(raw: string | null) { return parseBoards(raw).boards; }
export function updateBoards(raw: string | null, update: (boards: Board[]) => Board[]) {
    const parsed = parseBoards(raw);
    if (!parsed.writable) throw new Error('INVALID_STORED_BOARDS');
    return update(parsed.boards);
}
