/** Per-date source coverage for /mayor rolling-7-day charts. Pure and React-free, shared
 * by MayorShare (share chart) and TimeChart (raw candidate charts). */
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);

/** Each date sums the day and the six before it over four categories (tagid 3,4,5,6). */
export const MAYOR_EXPECTED_BUCKETS=28;
export type BucketCoverage={date:string;observed:number|null;status:'complete'|'partial'|'unknown'};

/** Joins report rows (`date`, `observedBuckets`) to the chart dates. Only that per-row count is
 * used, never the source-wide meta coverage; anything not a 0–28 integer stays unknown. */
export function mayorCoverage(rows:readonly Record<string,unknown>[]|undefined,dates:readonly string[]):BucketCoverage[]{
 const byDate=new Map<string,unknown>();for(const row of rows??[])if(typeof row.date==='string'&&!byDate.has(row.date))byDate.set(row.date,row.observedBuckets);
 return dates.map(date=>{const v=byDate.get(date),observed=Number.isInteger(v)&&(v as number)>=0&&(v as number)<=MAYOR_EXPECTED_BUCKETS?v as number:null;
  return {date,observed,status:observed===null?'unknown':observed===MAYOR_EXPECTED_BUCKETS?'complete':'partial'};});
}
export function coverageLabel(c:BucketCoverage|undefined){
 if(!c||c.status==='unknown')return '來源涵蓋未知（分類日桶數未提供）';
 return c.status==='complete'?`來源涵蓋 ${MAYOR_EXPECTED_BUCKETS}/${MAYOR_EXPECTED_BUCKETS} 個分類日桶`:`來源涵蓋 ${c.observed}/${MAYOR_EXPECTED_BUCKETS} 個分類日桶，觀測未完整`;
}
/** Short per-point tag: full coverage needs none; partial and unknown are named separately. */
export function coverageTag(c:BucketCoverage|undefined){return c?.status==='complete'?'':c?.status==='partial'?'（未完整）':'（涵蓋未知）';}
export function coverageCount(c:BucketCoverage|undefined){return c&&c.observed!==null?`${c.observed}/${MAYOR_EXPECTED_BUCKETS}`:'未知';}
/** Near-chart sentence listing every date that is not fully covered, or null when all are. */
export function incompleteCoverageNote(coverage:readonly BucketCoverage[]){
 const incomplete=coverage.filter(c=>c.status!=='complete');
 if(!incomplete.length)return null;
 return `${incomplete.map(c=>`${c.date} ${c.observed===null?'涵蓋未知':coverageCount(c)}`).join('、')} 的七日範圍分類日桶未完整或未知；這些日期的數值可能因缺少來源而偏低或偏高，不代表聲量下降。缺少的桶不補零。實線與實心點只用於涵蓋完整（${MAYOR_EXPECTED_BUCKETS}/${MAYOR_EXPECTED_BUCKETS}）的日期；虛線與空心點是未完整或涵蓋未知的觀測，不應與實線直接比較。`;
}
/** Per-point preparation for one line. `solid` keeps only complete dates (drawn with small solid
 * markers, so an isolated complete point, including a true 0, stays visible). `partial` flags
 * every incomplete/unknown observation (hollow) and each complete neighbour of one. It is a
 * per-point view only: drawn as a single line it would join C→C, so charts use incompleteRuns.
 * Null values stay gaps in both. */
export function coverageSegments(values:readonly (number|null)[],coverage:readonly BucketCoverage[]){
 const complete=(i:number)=>coverage[i]?.status==='complete';
 const solid=values.map((v,i)=>complete(i)&&finite(v)?v:null);
 const partial=values.map((v,i)=>{
  if(!finite(v))return null;
  if(!complete(i))return {value:v,hollow:true};
  const neighbour=[i-1,i+1].some(j=>j>=0&&j<values.length&&!complete(j)&&finite(values[j]));
  return neighbour?{value:v,hollow:false}:null;
 });
 return {solid,partial};
}
/** One full-length data array per maximal contiguous run of incomplete/unknown dates. Each run
 * holds its own points (hollow) plus only the complete finite point immediately before and after
 * it (no marker; the solid series draws that one). Separate runs never share an array, so a
 * dashed line can never cross a complete→complete interval. Null values stay gaps. */
export function incompleteRuns(values:readonly (number|null)[],coverage:readonly BucketCoverage[]){
 const complete=(i:number)=>coverage[i]?.status==='complete',runs:({value:number;hollow:boolean}|null)[][]=[];
 for(let i=0;i<values.length;){
  if(complete(i)){i++;continue;}
  let end=i;while(end+1<values.length&&!complete(end+1))end++;
  const run:({value:number;hollow:boolean}|null)[]=values.map(()=>null);
  for(let j=i;j<=end;j++){const v=values[j];if(finite(v))run[j]={value:v,hollow:true};}
  for(const j of [i-1,end+1]){const v=values[j];if(j>=0&&j<values.length&&finite(v))run[j]={value:v,hollow:false};}
  if(run.some(p=>p?.hollow))runs.push(run);
  i=end+1;
 }
 return runs;
}
/** ECharts line series for one coverage-encoded line: a solid series for complete dates and one
 * dashed series per incomplete run. All share `name`, so the legend shows one entry. */
export function coverageSeries(name:string,values:readonly (number|null)[],coverage:readonly BucketCoverage[],color:string){
 const solid={name,type:'line' as const,data:coverageSegments(values,coverage).solid,connectNulls:false,showSymbol:true,showAllSymbol:true,symbol:'circle',symbolSize:4,lineStyle:{width:2,color},itemStyle:{color}};
 const runs=incompleteRuns(values,coverage).map(run=>({name,type:'line' as const,data:run.map(p=>p===null?null:{value:p.value,symbol:p.hollow?'emptyCircle':'none',symbolSize:7}),connectNulls:false,showSymbol:true,showAllSymbol:true,lineStyle:{width:1.5,type:'dashed' as const,color,opacity:.8},itemStyle:{color,borderColor:color,borderWidth:1.5}}));
 return [solid,...runs] as [typeof solid,...typeof runs];
}
