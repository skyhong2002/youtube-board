import {metricPeriod,metricType,metricFilters,metricPeriodNote} from './metric-period.js';
import {observedMetric} from './observed-metrics.js';
import {ReportReadBound} from './cache-weights.js';
import { publishedTagCache, cacheLineageNote } from './cache-lineage.js';
import { sql } from 'drizzle-orm';
import type { Reader, Row } from '../db/client.js';
import { NotFound, type Query } from './query.js';
import { integer, text, latest } from './normalize.js';
import { table, range, cacheFilters, link, type Register } from './table.js';
import { groupDefinitions } from './group-definitions.js';
import { contentGroups } from './content-groups.js';
export function registerGroups(register: Register, reader: Reader, clock: () => Date) {
    register('/groups', async (_p, q) => {
        const records = await reader.rows(sql `SELECT group_name,COUNT(*) AS count,MAX(latest_time) AS latest FROM tag_group WHERE del_flag IS NULL OR del_flag<'1' GROUP BY group_name ORDER BY count DESC,group_name LIMIT 2001`);
        if (records.length > 2000) throw Object.assign(new Error('Group directory exceeds 2000 groups.'), {statusCode:422});
        const rows = records.map(r => ({ group: link(text(r.group_name), `/groups/${encodeURIComponent(text(r.group_name))}`), count: integer(r.count), kind: '內容詞彙群組' }));
        const names = new Set(records.map(r => text(r.group_name)));
        for (const [key, value] of Object.entries(contentGroups))
            if (!names.has(key)) rows.push({group:link(value.label, `/groups/${key}`),count:value.terms.length,kind:'既有設定詞彙群組'});
        for (const [key, value] of Object.entries(groupDefinitions)) {
            const collision = rows.findIndex(row => row.group.href === `/groups/${key}`);
            if (collision >= 0) rows.splice(collision, 1);
            rows.push({ group: link(value.label, `/groups/${key}`), count: value.groups.length, kind: '頻道分類群組' });
        }
        return table('觀測群組', [{ key: 'group', label: '群組' }, { key: 'kind', label: '分類依據' }, { key: 'count', label: '項目數', kind: 'number' }], rows, q, { updatedAt: latest(...records.filter(r => !Object.hasOwn(groupDefinitions, text(r.group_name))).map(r => r.latest)), notes: ['內容詞彙群組計算詞彙數；頻道分類群組計算子分類數，不是頻道數。兩種分類分開使用，不合併計數。', '詞彙名單優先採用來源維護的群組，缺少資料的已知群組才使用既有設定。群組名稱沿用來源標記；「現任立委」「現任縣市長」等名稱不代表已查核目前任職，請留意來源更新時間。2024 候選人為歷史名單。'] });
    });
    register('/groups/:name', async (p, q) => {
        p = {...p, name:p.name!.trim()};
        const definition = Object.hasOwn(groupDefinitions, p.name) ? groupDefinitions[p.name] : undefined;
        if (definition)
            return table(definition.label, [{ key: 'name', label: '分組' }, { key: 'filter', label: '分類條件' }], definition.groups.map(g => ({ name: link(g.name, `/channels?${new URLSearchParams(g.filters)}`), filter: new URLSearchParams(g.filters).toString() })), q);
        const records = await reader.rows(sql `SELECT tag,latest_time FROM tag_group WHERE group_name=${p.name} AND (del_flag IS NULL OR del_flag<'1') ORDER BY latest_time DESC,tag LIMIT 10001`);
        if (records.length > 10000) throw Object.assign(new Error('Group exceeds 10000 terms.'), {statusCode:422});
        const configured = Object.hasOwn(contentGroups, p.name) ? contentGroups[p.name] : undefined;
        if (!records.length && configured)
            return table(configured.label, [{key:'term',label:'詞彙'}], configured.terms.map(term => ({term:link(term, `/keywords/${encodeURIComponent(term)}/videos`)})), q, {updatedAt:null,notes:['來源為既有 GroupDirectoryReport 設定；非新聞共享詞彙同步。2024 候選人為歷史名單。']});
        if (!records.length)
            throw new NotFound();
        return table(configured?.label ?? p.name, [{ key: 'term', label: '詞彙' }, { key: 'updatedAt', label: '來源更新', kind: 'datetime' }], records.map(r => ({ term: link(text(r.tag), `/keywords/${encodeURIComponent(text(r.tag))}/videos`), updatedAt: text(r.latest_time) })), q, { updatedAt: latest(...records.map(r => r.latest_time)), notes:['來源為既有內容詞彙群組；名稱沿用來源標記，不代表已查核目前任職或分類。'] });
    });
    const metrics = async (name: string, q: Query, trend: boolean) => {
        const definition = Object.hasOwn(groupDefinitions, name) ? groupDefinitions[name] : undefined;
        if (!definition)
            throw new NotFound();
        const period=metricPeriod(q,clock,'group',trend),from=period.cacheFrom,type=trend?metricType(q.type,'group'):'total_views';
        const usedFrom=trend?new Date(Date.parse(period.dates[0]!)-6*86400000).toISOString().slice(0,10):period.dates[0]!;
        const loaded = await Promise.all(definition.groups.map(async (g) => ({ group: g, withheld:new Set<string>(), records: await reader.rows(sql `SELECT pk,ctime,mtime,the_date,total_views,count_videos FROM urt_show_tag_date WHERE pk IN(SELECT MAX(pk) FROM urt_show_tag_date WHERE ${cacheFilters(g.filters)} AND the_date BETWEEN ${from} AND ${period.to} GROUP BY the_date) ORDER BY the_date LIMIT 401`) })));
        let withheldDays=0;
        for (const item of loaded){if(item.records.length>400)throw new ReportReadBound('Group metric date capacity exceeded.');const before=item.records;
            item.records = await publishedTagCache(reader, item.records, item.group.filters);const published=new Set(item.records.map(r=>text(r.the_date).slice(0,10)));item.withheld=new Set(before.map(r=>text(r.the_date).slice(0,10)).filter(d=>d>=usedFrom&&!published.has(d)));withheldDays+=item.withheld.size;}

        const sources = loaded.map(({ group, records, withheld }) => {
            const byDate = new Map<string, Row>();
            for (const r of records) {
                const d = text(r.the_date).slice(0, 10);
                if (!byDate.has(d))
                    byDate.set(d, r);
            }
            return { group, byDate, records, withheld };
        });
        const updatedAt = latest(...sources.flatMap(s => s.records.filter(r=>text(r.the_date).slice(0,10)>=usedFrom).flatMap(r => [r.mtime, r.ctime]))),coverage={from:period.from,to:period.to,startBoundary:period.startBoundary,requestedDays:period.dates.length,todayOffset:period.today,withheldGroupDays:withheldDays,metric:type,medianScope:'recorded-values-only'};
        if (trend) {
            const coverageRows:Record<string,string|number|null>[]=[];
            const rows=period.dates.map(date=>{const row:Record<string,string|number|null>={date};
                for(const source of sources){const dates=Array.from({length:7},(_,i)=>new Date(Date.parse(date)-i*86400000).toISOString().slice(0,10)),window=dates.map(d=>source.byDate.get(d)),withheldDays=dates.filter(d=>source.withheld.has(d)).length,metric=observedMetric(window.map(r=>r?.[type]));row[source.group.name]=metric.sum;coverageRows.push({date,group:source.group.name,observedDays:window.filter(Boolean).length,knownDays:metric.knownDays,withheldDays,missingDays:7-window.filter(Boolean).length-withheldDays});}
                return row;});
            return {...table(definition.label+'七日趨勢',[{key:'date',label:'日期',kind:'date'},...sources.map(s=>({key:s.group.name,label:s.group.name,kind:'number' as const}))],rows,q,{updatedAt,series:sources.map(s=>({name:s.group.name,unit:type==='count_videos'?'部':'次',points:rows.map(r=>({time:String(r.date),value:r[s.group.name] as number|null}))})),filters:metricFilters(q,period,type),notes:[cacheLineageNote,metricPeriodNote(period),'每點為當日及前六日已記錄值加總；缺日或缺欄位不補零。有值但不足七日仍是部分觀測，涵蓋日數另列。群組可能重疊，不可相加作全站總計。'],sections:[{key:'window-coverage',title:'各群組窗口涵蓋',columns:[{key:'date',label:'日期',kind:'date'},{key:'group',label:'群組'},{key:'observedDays',label:'有快取日數',kind:'number'},{key:'knownDays',label:'度量有值日數',kind:'number'},{key:'withheldDays',label:'暫未發布日數',kind:'number'},{key:'missingDays',label:'無快取日數',kind:'number'}],rows:coverageRows}]}),period:{from:period.from,to:period.to},evidenceCoverage:coverage};
        }
        const rows=sources.map(source=>{const values=period.dates.map(d=>source.byDate.get(d)),views=observedMetric(values.map(r=>r?.total_views)),videos=observedMetric(values.map(r=>r?.count_videos));return {group:source.group.name,observedDays:values.filter(Boolean).length,requestedDays:period.dates.length,views:views.sum,viewsMedian:views.median,viewsKnownDays:views.knownDays,videos:videos.sum,videosMedian:videos.median,videosKnownDays:videos.knownDays};});
        return {...table(definition.label+'期間排行',[{key:'group',label:'分組'},{key:'views',label:'已觀測影片累計觀看加總',kind:'number'},{key:'viewsMedian',label:'日觀看總量中位數（有值日）',kind:'number'},{key:'viewsKnownDays',label:'觀看有值日數',kind:'number'},{key:'videos',label:'已觀測影片數',kind:'number'},{key:'videosMedian',label:'日影片數中位數（有值日）',kind:'number'},{key:'videosKnownDays',label:'影片有值日數',kind:'number'},{key:'observedDays',label:'有快取日數',kind:'number'},{key:'requestedDays',label:'選定日數',kind:'number'}],rows,q,{updatedAt,filters:metricFilters(q,period),notes:[cacheLineageNote,metricPeriodNote(period),'中位數只納入有記錄的日值；缺日與缺欄位不補零，因此與舊版補零中位數可能不同。加總亦僅涵蓋已知值，不能視為完整期間總量。','各日依影片發布日分桶；觀看是目前累計觀測，不是期間新增觀看。分類可重疊；列序沿用既有群組設定。']}),period:{from:period.from,to:period.to},evidenceCoverage:coverage};
    };
    register('/groups/:name/ranking', (p, q) => metrics(p.name, q, false));
    register('/groups/:name/trends', (p, q) => metrics(p.name, q, true));
}
