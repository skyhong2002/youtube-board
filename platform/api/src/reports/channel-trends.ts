import { sql } from 'drizzle-orm';
import type { Reader } from '../db/client.js';
import { channelReport, channelMetric } from '../legacy/channel.js';
import { BadQuery, type Query } from './query.js';
import { object, integer, latest } from './normalize.js';
import { range, table } from './table.js';
const modes = { observed: '相鄰日實測觀看差', orig: '原始觀看差', pred: '估計每日觀看', moving: '七日移動估計', videos: '相鄰日影片差' } as const;
type Mode = keyof typeof modes;
const previous = (date:string, days:number) => new Date(Date.parse(date)-days*86400000).toISOString().slice(0,10);
export async function channelTrends(reader:Reader,id:number,q:Query,clock:()=>Date) {
 const mode = q.mode ?? (q.videos !== undefined ? 'videos' : q.orig !== undefined ? 'orig' : q.each !== undefined ? 'pred' : 'moving');
 if(typeof mode !== 'string' || !Object.hasOwn(modes,mode))throw new BadQuery('Invalid channel trend mode.');
 const period=range(q,clock,30), projectionDays=Math.max(300,period.dates.length+5), start=previous(period.to,projectionDays+32).slice(0,7)+'-01';
 const logs=await reader.rows(sql`SELECT ctime,mtime,CASE WHEN OCTET_LENGTH(thedata)<=262144 THEN thedata ELSE NULL END AS thedata,OCTET_LENGTH(thedata) AS sourceBytes FROM urt_log WHERE u_id=${id} AND themonth>=${start} AND themonth<=${period.to} ORDER BY themonth,pk LIMIT 32`);
 if(logs.length===32 || logs.some(row=>(integer(row.sourceBytes)??(Buffer.isBuffer(row.thedata)?row.thedata.length:Buffer.byteLength(typeof row.thedata==='string'?row.thedata:JSON.stringify(row.thedata??''))))>262144))throw Object.assign(new Error('Channel history exceeds bounded report capacity.'),{statusCode:422});
 const points=new Map<string,{views:number|null;videos:number|null}>();
 for(const log of logs)for(const [date,value]of Object.entries(typeof log.thedata==='string'?object(log.thedata):{})) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<start||date>period.to)continue;
  const v=object(value);points.set(date,{views:integer(channelMetric(v,['view','total_views'])),videos:integer(channelMetric(v,['video','videos']))});
 }
 // The compatibility projector is the same reviewed Laravel daily estimation
 // algorithm; prefetch keeps SQL bounded and prevents extra source reads.
 const legacy=await channelReport(reader,{u_id:String(id),limit:projectionDays},new Date(period.to+'T12:00:00+08:00'),false,{logs,yearWeekKeys:true});
 const rows=period.dates.map(date=>{
  const point=points.get(date),prior=points.get(previous(date,1));
  const viewChange=point?.views!=null&&prior?.views!=null?point.views-prior.views:null;
  const videoChange=point?.videos!=null&&prior?.videos!=null?point.videos-prior.videos:null;
  const projection=legacy.result[date],prediction=integer(projection?.pred),moving=integer(projection?.moving);
  const movingDays=Array.from({length:7},(_,offset)=>integer(legacy.result[previous(date,offset)]?.pred)).filter(value=>value!==null&&value>0).length;
  // Legacy response uses zero for unavailable inference; the v1 contract
  // preserves that uncertainty without confusing raw zero differences with usable inference.
  const estimate=prediction!==null&&prediction>0?prediction:null;
  const movingEstimate=moving!==null&&moving>0&&movingDays===7?moving:null;
  const selected=mode==='videos'?videoChange:mode==='pred'?estimate:mode==='moving'?movingEstimate:viewChange;
  // One daily column for readers: the measured difference when both days were observed, else the projection, marked.
  const dailyViews=viewChange!==null?viewChange:estimate!==null?{value:estimate,detail:'估計'}:null;
  return {date,views:point?.views??null,videos:point?.videos??null,viewChange,videoChange,estimate,movingEstimate,movingDays,value:selected,dailyViews};
 });
 const unit=mode==='videos'?'部':'次';
 return table('頻道歷史趨勢',[
  {key:'date',label:'日期',kind:'date'},{key:'dailyViews',label:'每日觀看',kind:'number'},
  {key:'movingEstimate',label:'七日移動估計',kind:'number'},{key:'movingDays',label:'近七日估計可用',kind:'number',unit:'日'},{key:'views',label:'累計實測觀看',kind:'number'},
  {key:'videos',label:'累計實測影片',kind:'number'},{key:'videoChange',label:'相鄰日實測影片差',kind:'number'},
 ],rows,q,{updatedAt:latest(...logs.flatMap(r=>[r.mtime,r.ctime])),
  series:[{name:modes[mode as Mode],unit,points:rows.map(r=>({time:r.date,value:r.value}))}],
  metrics:[{label:'有效累計觀看觀測',value:rows.filter(r=>r.views!==null).length,unit:'日'},{label:'相鄰日實測差',value:rows.filter(r=>r.viewChange!==null).length,unit:'日'},{label:'估計可用',value:rows.filter(r=>r.estimate!==null).length,unit:'日'}],
  filters:[{key:'mode',label:'呈現方式',type:'select',value:mode,options:Object.entries(modes).map(([value,label])=>({value,label}))},{key:'from',label:'開始日期',type:'date',value:period.from},{key:'to',label:'結束日期',type:'date',value:period.to}],
  notes:['「每日觀看」有相鄰兩日實測時是實測差；缺任一日觀測時改用舊站公式的估計，並標示「估計」。兩者都沒有時維持空值；負差保留 YouTube 刪除或統計校正。圖表依「呈現方式」畫出所選的那一欄。', '估計以所選結束日期為基準，至少使用前 300 日計算；改變開始日期不會縮短近期估計的計算窗口。結束日期改變時，參考完整週會不同。新版週鍵包含 ISO 年份，避免跨年混算。', '此頁按結束日期重算並使用含年份的週鍵；與頻道摘要快取中的週／月預測值不必相同。', '估計不是實測；舊公式的零代表估計不可用，此處顯示空值。七日內不足七個有效估計日，移動估計也保持空值，原始零差與負差另列。', '日期窗口最多 366 日；每頁最多 200 列，圖表涵蓋整個窗口。資料量超出可處理範圍時會顯示限制，而不截取後冒充完整趨勢。']});
}
