import {registerLiveTaxonomyVideos} from './live-taxonomy-videos.js';
import {registerLiveContinuous} from './live-continuous.js';
import {registerLiveTagRanking} from './live-tag-ranking.js';
import {registerLiveVideoTrend} from './live-video-trend.js';
import { publishedLiveTagCache, cacheWindowNotes,cacheLineageNote } from './cache-lineage.js';
import { sql } from 'drizzle-orm';
import type { Reader, Row } from '../db/client.js';
import { BadQuery, NotFound, dateFilter, type Query } from './query.js';
import { integer, latest, object, text } from './normalize.js';
import { cacheFilters, range, table, type Register } from './table.js';
import { groupDefinitions } from './group-definitions.js';
import {metricMap} from './live-cache-shapes.js';
export {metricMap,hourlyPeak} from './live-cache-shapes.js';
import {registerLiveComparisons} from './live-comparison.js';

const sourceNote = '直播快取依小時彙整。峰值加總不是同一時刻在線人數、不重複觀眾或累計觀看；舊快取未記錄詞彙版本。缺少資料保留空值。';

function group(key: string) { const found = Object.hasOwn(groupDefinitions, key) ? groupDefinitions[key] : undefined; if (!found) throw new NotFound(); return found; }
export function registerLiveExtra(register: Register, reader: Reader, clock: () => Date) {
    const cacheRange = async (q: Query, filters: Query[] = [q], days = 7) => {
        if (q.to !== undefined || q.from !== undefined || q.today !== undefined) return range(q, clock, days, 120);
        const dates = await Promise.all(filters.map(f => reader.rows(sql`SELECT MAX(the_date) AS latest FROM urt_show_live_tag_date WHERE ${cacheFilters(f)}`)));
        const last = dates.map(r => text(r[0]?.latest).slice(0, 10)).filter(Boolean).sort().at(-1);
        return range(last ? { ...q, to: last } : q, clock, days, 120);
    };
    registerLiveTagRanking(register,reader,clock);
    register('/live/groups/:group/hours', async (p, q) => {
        q={...q};for(const key of ['date','type'])if(q[key]==='')delete q[key];
        if (q.type !== undefined && !['count','views'].includes(text(q.type))) throw new BadQuery('Unknown hourly metric.');
        const g = group(p.group), requested = dateFilter(q.date), period = requested ? { to: requested } : await cacheRange(q, g.groups.map(s => s.filters), 1);
        const sources = await Promise.all(g.groups.map(async s => {
            const metadata=(await reader.rows(sql`SELECT pk,ctime,mtime,the_date,OCTET_LENGTH(hour_result) AS hour_bytes FROM urt_show_live_tag_date WHERE ${cacheFilters(s.filters)} AND the_date=${period.to} ORDER BY pk DESC LIMIT 1`))[0];
            const visible=metadata?(await publishedLiveTagCache(reader,[metadata],s.filters))[0]:undefined;
            const body=visible&&Number(visible.hour_bytes)>0&&Number(visible.hour_bytes)<=131072?(await reader.rows(sql`SELECT OCTET_LENGTH(hour_result) AS body_bytes,CASE WHEN OCTET_LENGTH(hour_result)<=131072 THEN hour_result ELSE NULL END AS hour_result FROM urt_show_live_tag_date WHERE pk=${visible.pk} AND mtime <=> ${visible.mtime}`))[0]:undefined;
            const changed=!!visible&&Number(visible.hour_bytes)>0&&Number(visible.hour_bytes)<=131072&&(!body||body.hour_result===null||Number(body.body_bytes)!==Number(visible.hour_bytes));
            return {...s,row:visible?{...visible,hour_result:changed?null:body?.hour_result??null} as Row:undefined,oversized:visible?Number(visible.hour_bytes)>131072:false,withheld:!!metadata&&!visible,changed};
        }));
        const rows: Record<string, string | number | null>[] = Array.from({ length: 24 }, (_, i) => { const hour = String(i).padStart(2, '0'); return { hour, ...Object.fromEntries(sources.map(s => { const value = object(metricMap(s.row?.hour_result)[hour] ?? metricMap(s.row?.hour_result)[String(i)]); return [s.name, integer(q.type === 'count' ? value.count : value.views)]; })) }; });
        return table(`${g.label} ${period.to} 每小時直播`, [{ key: 'hour', label: '台北時間' }, ...sources.map(s => ({ key: s.name, label: s.name, kind: 'number' as const }))], rows, q, { updatedAt: latest(...sources.flatMap(s => [s.row?.mtime, s.row?.ctime])), series: sources.map(s => ({ name: s.name, unit: q.type === 'count' ? '部' : '人次', points: rows.map(r => ({ time: `${period.to}T${r.hour}:00:00+08:00`, value: r[s.name] as number | null })) })), notes: [sourceNote,cacheLineageNote,...cacheWindowNotes(sources.flatMap(s=>s.row?[s.row]:[])),...(sources.some(s=>s.withheld)?['部分群組日期仍在發布或含未知觀看值，已隱藏該日期所有版本。']:[]),...(sources.some(s=>s.changed)?['部分群組在讀取時變更，該群組顯示為缺值，請稍後重新查看。']:[]),...(sources.some(s=>s.oversized)?['部分群組的小時資料量過大，該群組顯示為缺值。']:[])], navigation:Object.entries(groupDefinitions).map(([key,value])=>({label:value.label,active:key===p.group,href:`/live/groups/${key}/hours?date=${period.to}&type=${q.type==='count'?'count':'views'}`})), filters: [{ key: 'date', label: '日期', type: 'date', value: period.to },{key:'type',label:'觀測度量',type:'select',value:q.type==='count'?'count':'views',options:[{value:'views',label:'各影片峰值加總'},{value:'count',label:'直播影片數'}]}] });
    });
    registerLiveComparisons(register,reader,clock);
    registerLiveTaxonomyVideos(register,reader,clock);
    registerLiveContinuous(register,reader,clock);
    registerLiveVideoTrend(register,reader);
}
