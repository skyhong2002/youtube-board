import { sql } from 'drizzle-orm';
import type { Reader, Row } from '../db/client.js';
import { publishedTagCache, publishedReportRow, unknownViewMeta } from '../reports/cache-lineage.js';
import { legacyViews, legacyTagSets } from './group-config.js';
import { addDay, bound, cacheWhere, counts, date, dateQuery, decode, dict, filters, int, meta, nonempty, obj, payload, php, str, txt, weighted, wrapped, type Q } from './common.js';
/** Group projector uses numeric, trimmed maps rather than the list-aware cloud decoder. */
function groupWeights(value: unknown): Record<string, number> {
    const raw = wrapped(value, ['result', 'data', 'tags']), out = dict<number>();
    if (Array.isArray(raw))
        return out;
    for (const [key, value] of Object.entries(raw)) {
        if (key.trim() && (typeof value === 'number' || typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) && Number.isFinite(Number(value)))
            out[key.trim()] = Math.trunc(Number(value));
    }
    return out;
}
export async function cloudReport(db: Reader, name: string, q: Q, now: Date): Promise<unknown> {
    if (name === 'cloud') {
        const uid = Math.max(1, int(q.uid ?? q.u_id, 2)), days = bound(q, 'days', 30, 3650), r = await publishedReportRow(db,'urt_show_cloud',{u_id:uid,days},(await db.rows(sql `SELECT * FROM urt_show_cloud WHERE u_id=${uid} AND days=${days} ORDER BY pk DESC LIMIT 1`))[0]), result = weighted(r?.keywords_json, true);
        return payload(result, 'urt_show_cloud.keywords_json', { u_id: uid, days, mtime: r?.mtime ?? null, cache_window:r?._cacheWindow??null, ...unknownViewMeta([r]), blocked_reason: nonempty(result) ? null : 'local channel cloud cache is empty; run reports:channel-cloud:build to rebuild urt_show_cloud' });
    }
    if (name !== 'group_view') {
        const noapi = name === 'cloud_tag_date_noapi', d = dateQuery(q, 'date', date(now)), type = noapi ? 'tags_result' : ['tags_result', 'tags_video', 'tags_views', 'all'].includes(str(q.type)) ? str(q.type) : 'tags_result', rows = await db.rows(sql `SELECT * FROM urt_show_tag_date WHERE the_date=${d} AND ${cacheWhere(q)} ${noapi ? sql `AND tags_count>0` : sql ``} ORDER BY pk DESC LIMIT 1`), f = filters(q, true), r = (await publishedTagCache(db, rows, { tagid: f.tagid.join(','), or: f.or.join(','), not: f.not.join(',') }))[0], result = weighted(r?.[type === 'all' ? 'tags_result' : type], true), out: Row = { ...payload(result, noapi ? 'urt_show_tag_date.noapi' : 'urt_show_tag_date', { filters: f, date: d, type, mtime: r?.mtime ?? null, cache_window:r?._cacheWindow??null, ...unknownViewMeta([r]), blocked_reason: nonempty(result) ? null : 'local tag-date cache is empty; legacy generation is intentionally not run' }), ...counts(r, ['total_views', 'count_channels', 'count_videos', 'count_tags']) };
        if (type === 'all')
            for (const k of ['tags_result', 'tags_video', 'tags_views'])
                out[k] = php(weighted(r?.[k], true));
        return out;
    }
    const group = txt(q, 'group', '六都市長候選人'), view = txt(q, 'view', 'politician'), days = bound(q, 'days', 30, 90), row = (await db.rows(sql `SELECT * FROM urt_show_group WHERE the_group LIKE ${group} AND the_view LIKE ${view} LIMIT 1`))[0], cached = decode(row?.the_result);
    let tags = txt(q, 'tags').split(',').map(t => t.trim()).filter(t => t && t !== '0');
    if (!tags.length)
        tags = group.startsWith('tags_') ? Object.hasOwn(legacyTagSets, group) ? legacyTagSets[group]! : [] : (await db.rows(sql `SELECT tag FROM tag_group WHERE group_name=${group} AND (del_flag IS NULL OR del_flag<'1') ORDER BY latest_time DESC,tag`)).map(r => str(r.tag)).filter(t => t && t !== '0');
    const views = Object.hasOwn(legacyViews, view) ? legacyViews[view]! : legacyViews.politician!, dates = Array.from({ length: days + 8 }, (_, i) => date(now, -i)), groupData: Row[] = [], data = dict<Record<string, Record<string, Row>>>(), usedRows: Row[] = [];
    let source = 0, blocked = !Object.hasOwn(legacyViews, view) ? 'unknown_view' : !tags.length ? 'missing_group_tags' : tags.length > 600 ? 'tag_list_limit_exceeded' : null;
    if (!blocked)
        for (let g = 0; g < views.length; g++) {
            const f = Object.fromEntries(views[g]!.tag_para.split(/\s+/).map(s => s.split('='))), records = await db.rows(sql `SELECT * FROM urt_show_tag_date WHERE ${cacheWhere(f)} AND the_date BETWEEN ${dates.at(-1)} AND ${dates[0]} ORDER BY pk DESC`), published = await publishedTagCache(db, records, f), map = new Map<string, Row>();
            for (const r of published) {
                const d = str(r.the_date).slice(0, 10);
                if (!map.has(d))
                    map.set(d, r);
            }
            source += map.size;
            for (let i = 0; i <= days; i++) { const used = map.get(dates[i]!); if (used) usedRows.push(used); }
            const totals: Row = { total_views: 0, count_videos: 0 };
            for (let i = 0; i <= days; i++) {
                const d = dates[i]!, r = map.get(d), views = int(r?.total_views), videos = int(r?.count_videos);
                totals.total_views = int(totals.total_views) + views;
                totals.count_videos = int(totals.count_videos) + videos;
                totals[d] = { count_videos: videos, total_views: views };
            }
            groupData.push(totals);
            for (const d of dates) {
                const r = map.get(d);
                if (!r)
                    continue;
                const tv = groupWeights(r.tags_views), tc = groupWeights(r.tags_video);
                tags.forEach((tag, t) => {
                    const views = int(tv[tag]), videos = int(tc[tag]);
                    if (views > 0 || videos > 0) {
                        const dst = ((data[t] ??= dict())[g] ??= dict())[d] ??= {};
                        if (views > 0)
                            dst.tags_views = views;
                        if (videos > 0)
                            dst.tags_video = videos;
                    }
                });
            }
        }
    if (!blocked && !source)
        blocked = 'missing_tag_date_source';
    if (blocked && nonempty(cached))
        return { ...cached, meta: meta('urt_show_group.the_result', true, { group, view, mtime: row?.mtime ?? null, cache_available: true, cache_role: 'imported_historical_fallback', window_coverage: 'unknown', blocked_reason: blocked, note: 'Dynamic source unavailable; historical snapshot does not claim the requested period.' }) };
    if (blocked)
        return { result: { tag_array: tags, group_array: views, group_data: {}, data_array: {} }, meta: meta('tag_group + legacy group config', tags.length > 0 && views.length > 0, { group, view, cache_available: false, cache_strategy: 'dynamic-tag-date-projection', projection_complete: false, blocked_reason: blocked }) };
    // PHP serializes sequential integer-key arrays as lists; sparse keys stay objects.
    const packed = (x: Record<string, unknown>): unknown => { const entries = Object.entries(x); return entries.every(([k], i) => k === String(i)) ? entries.map(([, v]) => v) : x; };
    for (const k of Object.keys(data))
        data[k] = packed(data[k]!) as Record<string, Record<string, Row>>;
    return { result: { tag_array: tags, group_array: views, group_data: groupData, data_array: packed(data) }, meta: meta('urt_show_tag_date derived real-time YouTube dashboard', true, { group, view, days, cache_available: false, cache_strategy: 'dynamic-tag-date-projection', ...unknownViewMeta(usedRows) }) };
}
