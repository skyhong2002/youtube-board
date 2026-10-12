import { sourceMap, sourceAliases } from './source-map.js';
import { sql } from 'drizzle-orm';
import type { Reader } from '../db/client.js';
import { BadQuery, NotFound, type Query } from './query.js';
import { latest, text } from './normalize.js';
import { cacheFilters, range, table, weights, type Register } from './table.js';
import { cacheLineageNote, publishedTagCache } from './cache-lineage.js';
import { groupDefinitions } from './group-definitions.js';

export function registerComparisons(register: Register, reader: Reader, clock: () => Date) {
    const compare = async (q: Query, terms: string[], groups: { name: string; filters: Query }[], title: string) => {
        const period = range(q, clock, 7, 90), from = new Date(Date.parse(period.from)-6*86400000).toISOString().slice(0,10);
        const aliases: Record<string,string> = { tags_view:'tags_views',total_views:'tags_views',count_videos:'tags_video' }, raw = text(q.type)||'tags_views', type = aliases[raw] ?? raw;
        if (!['tags_views','tags_video','tags_result'].includes(type)) throw new BadQuery('Unknown comparison metric.');
        const sources = await Promise.all(groups.map(async g => {
            const records = await publishedTagCache(reader, await reader.rows(sql`SELECT pk,ctime,mtime,the_date,tags_views,tags_video,tags_result FROM urt_show_tag_date WHERE ${cacheFilters(g.filters)} AND the_date BETWEEN ${from} AND ${period.to} ORDER BY pk DESC`),g.filters);
            const days = new Map<string, Map<string,number>>(), seen = new Set<string>();
            for (const r of records) { const date = text(r.the_date).slice(0,10); if (!seen.has(date)) { seen.add(date); if (!sourceMap(r[type])) continue; const map = weights(sourceAliases(sourceMap(r[type])!)); days.set(date,map); } }
            return {...g,records,days};
        }));
        const rows: Record<string,string|number|null>[]=[];
        for (const date of period.dates) {
            const row: Record<string,string|number|null>={date};
            for (const s of sources) for (const term of terms) {
                let observed=0,value=0;
                for(let i=0;i<7;i++){const map=s.days.get(new Date(Date.parse(date)-i*86400000).toISOString().slice(0,10));if(map){observed++;value+=(map.get(term)??0)*(type==='tags_result'?100:1);}}
                const key=`series_${sources.indexOf(s)}_${terms.indexOf(term)}`; row[key]=observed?value:null;row[`${key}：日數`]=observed;
            }
            rows.push(row);
        }
        const keys=sources.flatMap((s,i)=>terms.map((term,j)=>({key:`series_${i}_${j}`,label:groups.length>1?`${s.name}／${term}`:term})));
        return table(title,[{key:'date',label:'日期',kind:'date'},...keys.flatMap(({key,label})=>[{key,label,kind:'number' as const},{key:`${key}：日數`,label:`${label} 覆蓋日`,kind:'number' as const}])],rows,q,{updatedAt:latest(...sources.flatMap(s=>s.records.flatMap(r=>[r.mtime,r.ctime]))),series:keys.map(({key,label})=>({name:label,unit:type==='tags_video'?'影片引用':type==='tags_views'?'觀看引用':'重要度',points:rows.map(r=>({time:String(r.date),value:r[key] as number|null}))})),notes:[cacheLineageNote,'使用精確分類條件的日快取，累加當日與前六日。分類可以重疊；不合併不同條件的單分類快取來冒充交集。','重要度沿用舊版 ×100 量尺；詞彙屬於快取產生當時的來源，新聞文章數不參與觀看計算。']});
    };
    register('/tags/compare',(_p,q)=>{
        if(q.tags!==undefined&&(typeof q.tags!=='string'||q.tags.length>2048))throw new BadQuery('Invalid comparison terms.');
        const terms=[...new Set((text(q.tags)||'蔡英文,柯文哲,賴清德,侯友宜').split(',').map(s=>s.trim()).filter(Boolean))];
        if(terms.length>12||terms.some(t=>t.length>240))throw new BadQuery('Compare at most 12 terms, each at most 240 characters.');
        return compare(q,terms,[{name:'選定分類',filters:q}],'詞彙七日比較');
    });
    register('/keywords/:keyword/groups/trends',(p,q)=>{
        const key=text(q.view)||'position',g=Object.hasOwn(groupDefinitions,key)?groupDefinitions[key]:undefined;if(!g)throw new NotFound();
        return compare(q,[p.keyword],g.groups,`${p.keyword}：${g.label}七日趨勢`);
    });
}
