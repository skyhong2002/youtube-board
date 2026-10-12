import { reportCacheKey } from '../../shared/report-cache-key.js';
import type { RowDataPacket } from 'mysql2/promise';
import { cap } from './channel-jobs.js';
import { jsonMap, selectOne, taipeiSql, update, upsert } from './legacy-db.js';
import { unsigned } from './youtube.js';
import { checkedSum, daysBetween, type CacheContext } from './report-caches.js';
import { workflowShutdownSignal } from '../../shared/shutdown.js';
const addDay=(day:string,offset:number)=>new Date(Date.parse(day)+offset*86400000).toISOString().slice(0,10);
function week(day:string){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));return Math.ceil(((+d-Date.UTC(d.getUTCFullYear(),0,1))/86400000+1)/7);}
const weekday=(day:string)=>new Date(day+'T00:00:00Z').getUTCDay();
const median=(a:number[])=>{a.sort((x,y)=>x-y);return a.length?(a[Math.floor((a.length-1)/2)]!+a[Math.floor(a.length/2)]!)/2:0;};
/** Preserves the legacy seven-day seasonal interpolation and its 10M daily outlier cap. */
export function channelPredictionSummary(logs:unknown[],today:string){
 const dates:Record<string,number>=Object.create(null);for(const raw of logs){for(const [day,value]of Object.entries(jsonMap(raw))){daysBetween(day,day);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid channel history');const point=value as Record<string,unknown>,view=point.view??point.total_views;if(view!==undefined){const n=unsigned(view);if(n===null)throw new Error('Invalid channel view observation');if(Object.hasOwn(dates,day))throw new Error('Duplicate channel observation date');dates[day]=n;}}}
 if(Object.keys(dates).filter(d=>d<=today).length<2)throw new Error('Insufficient channel history');
 const limit=29,pred:Record<string,number>=Object.create(null),weeks:Record<string,Record<number,number>>=Object.create(null),weekSum:Record<string,number>=Object.create(null),weekCount:Record<string,number>=Object.create(null);
 for(let i=limit+30;i>=0;i--){const d=addDay(today,-i),y=addDay(d,-1),t=addDay(d,-2),v=(dates[d]??0)-(dates[y]??0);if(!(v<0||v>10000000||!dates[y]||dates[y]===dates[t]||!dates[t]))pred[d]=v;}
 for(let i=limit+30;i>=0;i--){const d=addDay(today,-i),v=pred[d]??0;if(v<=0)continue;const w=week(d);weekSum[w]=checkedSum(weekSum[w]??0,v);weekCount[w]=(weekCount[w]??0)+1;(weeks[w]??={})[weekday(d)]=v;}
 const ratios=Array.from({length:7},(_,day)=>{const values=[];for(let i=1;i<=12;i++){const w=week(addDay(today,-i*7));if(weekCount[w]===7&&(weekSum[w]??0)>0)values.push(Number(((weeks[w]?.[day]??0)/weekSum[w]!).toFixed(4)));}return median(values);}),sum=ratios.reduce((a,b)=>a+b,0);
 if(sum>0){for(let i=0;i<7;i++)ratios[i]=ratios[i]!/sum;for(let i=limit+14;i>=0;i--){const d=addDay(today,-i);if((pred[d]??0)>0)continue;const known=weeks[week(d)]??{},med=Object.keys(known).reduce((s,k)=>s+ratios[Number(k)]!,0),total=Object.values(known).reduce(checkedSum,0);pred[d]=med>0?Math.trunc(total/med*ratios[weekday(d)]!):0;}}
 const values=Array.from({length:29},(_,i)=>pred[addDay(today,-i)]??0);return {views_pred_week:values.slice(0,7).reduce(checkedSum,0),views_pred_month:values.reduce(checkedSum,0)};
}
export async function predictionsCacheJob(ctx:CacheContext,input:{uId?:number;limit:number;afterId?:number}){
 cap(input.limit,100);if(input.uId)cap(input.uId,2147483647);cap(input.afterId??0,2147483647,0);
 const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT c.u_id FROM urt_count c LEFT JOIN ts_cache_item_state p ON p.workflow='reports.channel_predictions.build' AND p.item_key=CAST(c.u_id AS CHAR) WHERE ${input.uId?'c.u_id=?':'c.u_id>?'} ORDER BY ${input.afterId!==undefined?'c.u_id':'p.processed_at,c.u_id'} LIMIT ?`,[input.uId??input.afterId??0,input.limit+1]),applied:number[]=[],skipped:{uId:number;reason:string}[]=[],unavailable:number[]=[];
 for(const row of rows.slice(0,input.limit)){await ctx.assertOwnership();if(ctx.execute)await ctx.db.execute("INSERT INTO ts_cache_item_state(workflow,item_key,source_stamp,processed_at) VALUES('reports.channel_predictions.build',?,?,?) ON DUPLICATE KEY UPDATE source_stamp=VALUES(source_stamp),processed_at=VALUES(processed_at)",[String(row.u_id),taipeiSql(ctx.now),taipeiSql(ctx.now)]);const [logs]=await ctx.db.query<RowDataPacket[]>('SELECT themonth,thedata FROM urt_log WHERE u_id=? AND (themonth IS NULL OR themonth BETWEEN ? AND ?) ORDER BY themonth,pk LIMIT 5',[row.u_id,addDay(taipeiSql(ctx.now).slice(0,10),-90).slice(0,7)+'-01',taipeiSql(ctx.now).slice(0,7)+'-01']);let result;try{if(logs.length>4||new Set(logs.map(r=>String(r.themonth))).size!==logs.length)throw new Error('Duplicate channel months');result=channelPredictionSummary(logs.map(r=>r.thedata),taipeiSql(ctx.now).slice(0,10));}catch(error){if(ctx.execute){await ctx.assertOwnership();await update(ctx.db,'urt_count',{u_id:row.u_id},{views_pred_week:null,views_pred_month:null});}if(error instanceof Error&&error.message==='Insufficient channel history')unavailable.push(row.u_id);else skipped.push({uId:row.u_id,reason:'invalid-history'});continue;}if(ctx.execute){await ctx.assertOwnership();await update(ctx.db,'urt_count',{u_id:row.u_id},result);applied.push(row.u_id);}}
 return {mode:ctx.execute?'execute':'dry-run',selected:Math.min(rows.length,input.limit),truncated:rows.length>input.limit,...(input.afterId!==undefined?{nextAfterId:rows.slice(0,input.limit).at(-1)?.u_id??input.afterId}:{}),applied,skipped,unavailable};
}
export function safeWikipediaImage(value:unknown):string|null{
 if(typeof value!=='string'||Buffer.byteLength(value)>256||/[\s\x00-\x1f]/.test(value))return null;
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='upload.wikimedia.org'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.pathname.startsWith('/wikipedia/')&&Buffer.byteLength(u.href)<=256?u.href:null;}catch{return null;}
}
/** Fixed public API origin, no redirects, bounded stream, timeout, no image downloading. */
export async function wikipediaPhoto(tag:string,fetcher:typeof fetch=fetch):Promise<string|null>{
 if(!tag||[...tag].length>32||/[\uD800-\uDFFF]/u.test(tag))throw new Error('Invalid photo term');
 const url=new URL('https://zh.wikipedia.org/w/api.php');url.search=new URLSearchParams({action:'query',format:'json',prop:'pageimages',titles:tag,pithumbsize:'500',redirects:'1'}).toString();
 let response:Response;try{response=await fetcher(url,{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(15000),workflowShutdownSignal()]),headers:{'User-Agent':'YouTubeBoard/TypeScript (https://youtube.observe.tw)','Accept':'application/json'}});}catch{throw new Error('Wikipedia request failed');}
 if(!response.ok||!response.body){await response.body?.cancel();throw new Error('Wikipedia response unavailable');}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>1024*1024)throw new Error('Wikipedia response exceeds cap');chunks.push(next.value);}}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
 const raw:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!raw||typeof raw!=='object'||Array.isArray(raw)||'error'in raw)throw new Error('Invalid Wikipedia response');const query=(raw as {query?:unknown}).query;
 if(!query||typeof query!=='object'||Array.isArray(query))throw new Error('Invalid Wikipedia query');const pages=(query as {pages?:unknown}).pages;
 if(!pages||typeof pages!=='object'||Array.isArray(pages)||Object.keys(pages).length!==1)throw new Error('Invalid Wikipedia page result');
 const page=Object.values(pages)[0];if(!page||typeof page!=='object'||Array.isArray(page))throw new Error('Invalid Wikipedia page');const source=(page as {thumbnail?:{source?:unknown}}).thumbnail?.source;
 if(source===undefined)return null;const image=safeWikipediaImage(source);if(!image)throw new Error('Invalid Wikipedia thumbnail');return image;
}
export async function selectPhotoTerms(ctx:Pick<CacheContext,'db'|'now'>,terms:string[],limit:number,refresh=false) {
 cap(limit,100);const [stored]=await ctx.db.query<RowDataPacket[]>('SELECT tag,image_url FROM urt_show_photo ORDER BY pk LIMIT 10001'),[states]=await ctx.db.query<RowDataPacket[]>("SELECT item_key,processed_at,retry_after FROM ts_cache_item_state WHERE workflow='reports.photos.build' LIMIT 10001");
 if(stored.length>10000||states.length>10000)throw new Error('Photo selection state cap reached');
 const cached=new Set(stored.filter(r=>safeWikipediaImage(r.image_url)).map(r=>String(r.tag))),state=new Map(states.map(r=>[String(r.item_key),r]));
 return terms.map(term=>({term,state:state.get(reportCacheKey({tag:term}))})).filter(({term,state})=>[...term].length<=32&&(refresh||!cached.has(term))&&(!state?.retry_after||String(state.retry_after)<=taipeiSql(ctx.now))).sort((a,b)=>String(a.state?.processed_at??'').localeCompare(String(b.state?.processed_at??''))).slice(0,limit).map(row=>row.term);
}
async function photoAttempt(ctx:CacheContext,term:string,outcome:'published'|'no-thumbnail'|'source-failed') {
 await ctx.assertOwnership();const key=reportCacheKey({tag:term}),[rows]=await ctx.db.query<RowDataPacket[]>("SELECT attempts FROM ts_cache_item_state WHERE workflow='reports.photos.build' AND item_key=?",[key]);
 const attempts=outcome==='source-failed'?Math.min(12,Number(rows[0]?.attempts??0)+1):0,delay=outcome==='source-failed'?Math.min(86400000,300000*2**(attempts-1)):outcome==='no-thumbnail'?7*86400000:0;
 await ctx.db.execute("INSERT INTO ts_cache_item_state(workflow,item_key,source_stamp,processed_at,outcome,retry_after,attempts) VALUES('reports.photos.build',?,?,?,?,?,?) ON DUPLICATE KEY UPDATE source_stamp=VALUES(source_stamp),processed_at=VALUES(processed_at),outcome=VALUES(outcome),retry_after=VALUES(retry_after),attempts=VALUES(attempts)",[key,taipeiSql(ctx.now),taipeiSql(ctx.now),outcome,delay?taipeiSql(new Date(ctx.now.getTime()+delay)):null,attempts]);
}
export async function photosCacheJob(ctx:CacheContext,input:{terms:string[];limit:number;refresh?:boolean},fetcher:typeof fetch=fetch){
 cap(input.limit,100);if(input.terms.length>input.limit||input.terms.some(t=>!t||[...t].length>32||/[\uD800-\uDFFF]/u.test(t))||new Set(input.terms).size!==input.terms.length)throw new Error('Explicit photo terms exceed caps');
 const applied:string[]=[],skipped:{term:string;reason:string}[]=[],withoutThumbnail:string[]=[];let requests=0,cached=0;
 for(const term of input.terms){const existing=await selectOne(ctx.db,'urt_show_photo',{tag:term});if(existing&&safeWikipediaImage(existing.image_url)&&!input.refresh){cached++;continue;}if(!ctx.execute)continue;
 await ctx.assertOwnership();let image:string|null;try{requests++;image=await wikipediaPhoto(term,fetcher);}catch{await ctx.assertOwnership();await photoAttempt(ctx,term,'source-failed');skipped.push({term,reason:'photo-source-invalid-or-unavailable'});continue;}if(!image){await photoAttempt(ctx,term,'no-thumbnail');withoutThumbnail.push(term);continue;}
 await ctx.assertOwnership();await upsert(ctx.db,'urt_show_photo',{tag:term},{...(existing?{}:{ctime:taipeiSql(ctx.now)}),mtime:taipeiSql(ctx.now),image_url:image,image_source:'wiki'});await photoAttempt(ctx,term,'published');applied.push(term);
 }
 return {mode:ctx.execute?'execute':'dry-run',selected:input.terms.length,externalRequests:requests,cached,applied,skipped,withoutThumbnail};
}
