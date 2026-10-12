import {registerStoredLiveAggregates} from './live-stored-aggregates.js';
import {registerLiveHourMatrix} from './live-hour-matrix.js';
import {ReportReadBound} from './cache-weights.js';
import {loadLiveLogs,visibleLiveTags,observedCount,liveCoverageNote,liveChannelTitleSql} from './live-observations.js';
import {livePeriod,livePeriodControls} from './live-period.js';
import { sql } from 'drizzle-orm';
import type { Reader } from '../db/client.js';
import { tagFilter, dateFilter, search, page, type Query } from './query.js';
import { object, text, integer, latest, timestamp } from './normalize.js';
import { table, range, link, type Register } from './table.js';
export function registerLiveHistory(register: Register, reader: Reader, clock: () => Date) {
    const live = async (q: Query, mode: 'videos',pathDate?:string) => {
        page(q);const term=search(q.q),requestNow=clock(),videoPeriod=mode==='videos'?livePeriod(q,()=>requestNow,pathDate):null,period=videoPeriod??range(q,()=>requestNow,7,90);
        const{rows:logs,coverage}=await loadLiveLogs(reader,sql`l.the_date BETWEEN ${period.from} AND ${period.to} AND ${tagFilter(q)} ${term?sql`AND(COALESCE(s.title,v.title,'') COLLATE utf8mb4_unicode_ci LIKE ${term} ESCAPE '=' OR COALESCE(${liveChannelTitleSql},'') COLLATE utf8mb4_unicode_ci LIKE ${term} ESCAPE '=')`:sql``}`,true);
        const partialVideos=new Set(logs.filter(r=>r.partial).map(r=>text(r.videoId)));
        const tagNames=mode==='videos'?new Map((await reader.rows(sql`SELECT tag_id,tag_name FROM urt_tag ORDER BY tag_id`)).map(r=>[integer(r.tag_id)??0,text(r.tag_name)])):new Map<number,string>();
        const peaks = new Map<string, {
            date: string;
            id: string;
            channelId: number;
            title: string;
            channelTitle: string;
            peak: number;
            tags:string;
        }>(), hourVideo = new Map<string, {
            date: string;
            hour: string;
            id: string;
            peak: number;
        }>();
        for (const log of logs) {
            const date = text(log.the_date).slice(0, 10), id = text(log.videoId), values = log.samples;
            let peak = observedCount(log.max_current) ?? 0, hasSample = observedCount(log.max_current) !== null;
            for (const [time, value] of values) {
                const number = observedCount(value);
                if (number === null || !/^([01]\d|2[0-3]):[0-5]\d/.test(time))
                    continue;
                hasSample = true;
                peak = Math.max(peak, number);
                const hour = time.slice(0, 2), key = date + '|' + hour + '|' + id, prior = hourVideo.get(key);
                hourVideo.set(key, { date, hour, id, peak: Math.max(number, prior?.peak ?? 0) });
            }
            if (!hasSample)
                continue;
            const key = date + '|' + id, prior = peaks.get(key);
            peaks.set(key, { date, id, channelId: integer(log.u_id) ?? 0, title: text(log.title) || id, channelTitle: text(log.channel_title) || '頻道名称待補', peak: Math.max(peak, prior?.peak ?? 0),tags:visibleLiveTags(log.tags,tagNames).map(t=>t.name).join(' · ') });
        }
        const updatedAt = latest(...logs.flatMap(r => [r.mtime, r.ctime]));
        const byVideo = new Map<string, typeof peaks extends Map<string, infer T> ? T : never>();
        for (const r of peaks.values()) {
            const prior = byVideo.get(r.id);
            if (r.peak>0&&(!prior || r.peak > prior.peak))
                byVideo.set(r.id, r);
        }
        const rows = [...byVideo.values()].sort((a, b) => b.peak - a.peak||b.date.localeCompare(a.date)||a.id.localeCompare(b.id)).map(r => ({ video: link(r.title, `/videos/${encodeURIComponent(r.id)}`), channel: link(r.channelTitle, `/channels/${r.channelId}`), date: r.date, peak: r.peak,tags:r.tags,evidence:partialVideos.has(r.id)?'部分取樣':'可用取樣',trend:link('查看觀測',`/live/videos/${encodeURIComponent(r.id)}/trend`) }));
        return {...table('直播期間排行', [{ key: 'video', label: '影片' }, { key: 'channel', label: '頻道' }, {key:'tags',label:'頻道分類'}, { key: 'date', label: '峰值日期', kind: 'date' }, { key: 'peak', label: '實測峰值在線', kind: 'number' },{key:'evidence',label:'取樣範圍'},{key:'trend',label:'歷史觀測'}], rows, q, { updatedAt,...livePeriodControls(q,videoPeriod!,pathDate?'/live/days':'/live/periods'), notes: ['以來源峰值及有效取樣取最大值；未觀測時段的真正峰值可能更高。',liveCoverageNote,'預設為台北今日；單日／起訖最多90日。無效、顛倒、超界日期回報錯誤，不自動改成另一段期間。'] }),evidenceCoverage:{...coverage,from:period.from,to:period.to}};
    };
    register('/live/days', (_p,q)=>live(q,'videos'));
    register('/live/periods', (_p,q)=>live(q,'videos'));
    register('/live/days/:date', (p,q)=>live(q,'videos',dateFilter(p.date)!));
    registerStoredLiveAggregates(register,reader,clock);
    registerLiveHourMatrix(register,reader,clock);
}
