'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {cities} from '../../../shared/city-definitions';
import {chartTimeLabel} from '@/lib/chart-window';
import {compact,count} from '@/lib/format';
import {reportStyle as ui} from '@/lib/report-styles';
import type {ChartPoint} from './Charts';
import {CoverageDisclosure} from './CoverageDisclosure';
import {MAYOR_EXPECTED_BUCKETS,coverageLabel,coverageSeries,coverageTag,incompleteCoverageNote,mayorCoverage} from '@/lib/bucket-coverage';

/** Bloc colours follow the Laravel mayor page palette (KMT blue, DPP green, TPP cyan, others purple). */
const BLOC_COLORS:Record<string,string>={blue:'#2563eb',green:'#16a34a',white:'#0891b2',other:'#7c3aed'};
const FALLBACK=['#2563eb','#16a34a','#64748b','#0891b2','#7c3aed','#be123c'];
/** Minor-party and independent candidates each get their own hue, kept clear of the party blues and greens. */
const OTHER_COLORS=['#7c3aed','#be123c','#b45309','#db2777','#64748b','#0d9488','#a16207'];
const MAYOR_TAGIDS='3,4,5,6';
type Series={name:string;unit:string;points:ChartPoint[]};

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
/** Same-day share across the listed candidates; mirrors the API's `{candidate}：占比` columns.
 * Fails closed: if any candidate's value is missing that date, the denominator is unknown and
 * every share is null (a lone known candidate is never 100%). Recorded zeros stay; all-zero is 0. */
export function mayorShares(series:Series[]){
 const length=Math.max(0,...series.map(s=>s.points.length));
 return series.map(s=>({name:s.name,points:Array.from({length},(_,i)=>{
  const time=s.points[i]?.time??series.find(o=>o.points[i])?.points[i].time??'',values=series.map(other=>other.points[i]?.value);
  if(!values.every(finite))return {time,value:null};
  const total=(values as number[]).reduce((sum,v)=>sum+v,0);
  return {time,value:total>0.000001?(values[series.indexOf(s)] as number)/total*100:0};
 })}));
}
const share=(value:number|null|undefined)=>value===null||value===undefined?'n/a':value.toFixed(1)+'%';
export {MAYOR_EXPECTED_BUCKETS,coverageLabel,coverageSegments,mayorCoverage,type BucketCoverage} from '@/lib/bucket-coverage';

/** Mayor pages render this twice: the share chart right after the filters, and the candidate cards below it. */
export function MayorShare({part,city,series,search,rows}:{part:'chart'|'candidates';city:string;series:Series[];search:Record<string,string|string[]|undefined>;rows?:readonly Record<string,unknown>[]}){
 const blocs=cities[city]?.candidates??{},others=Object.keys(blocs).filter(name=>blocs[name]==='other'),color=(name:string,index:number)=>blocs[name]==='other'?OTHER_COLORS[others.indexOf(name)%OTHER_COLORS.length]!:BLOC_COLORS[blocs[name]??'']??FALLBACK[index%FALLBACK.length];
 const shares=mayorShares(series),dates=shares[0]?.points.map(p=>p.time)??[],coverage=mayorCoverage(rows,dates);
 // Latest date on which any candidate has a share; a missing candidate there stays n/a.
 const lastIndex=(()=>{for(let i=dates.length-1;i>=0;i--)if(shares.some(s=>s.points[i]?.value!==null))return i;return -1;})();
 const last=lastIndex<0?undefined:{index:lastIndex},one=(key:string)=>{const value=search[key];return Array.isArray(value)?value[0]:value;};
 const lastCoverage=last?coverage[last.index]:undefined,incomplete=coverage.filter(c=>c.status!=='complete');
 const ref=useRef<HTMLDivElement>(null),[failed,setFailed]=useState(false),[view,setView]=useState<'share'|'raw'>('share');
 const unit=series[0]?.unit??'',raw=view==='raw',plotted=raw?series:shares;
 useEffect(()=>{if(part!=='chart'||!dates.length)return;let disposed=false,chart:import('echarts').ECharts|undefined,resize:ResizeObserver|undefined,observer:MutationObserver|undefined;
  async function load(){const echarts=await import('echarts');if(disposed||!ref.current)return;chart=echarts.init(ref.current,undefined,{renderer:'svg'});
   const render=()=>{const style=getComputedStyle(document.documentElement),muted=style.getPropertyValue('--muted').trim(),line=style.getPropertyValue('--line').trim(),panel=style.getPropertyValue('--panel').trim(),fg=style.getPropertyValue('--foreground').trim();
    chart?.setOption({animation:false,aria:{enabled:true,label:{description:`候選人${raw?unit+'七日合計':'媒體聲量占比'}趨勢，${dates[0]}～${dates[dates.length-1]}`}},textStyle:{fontFamily:style.fontFamily,color:muted,fontSize:12},
     legend:{type:'scroll',left:0,right:0,top:0,textStyle:{color:muted,fontSize:12}},grid:{left:56,right:24,top:40,bottom:32},
     // Plain-text tooltip: the date's coverage first, then every candidate's share or raw value once (both line parts share one name).
     tooltip:{trigger:'axis',renderMode:'richText',confine:true,backgroundColor:panel,borderColor:line,textStyle:{color:fg,fontSize:12},
      formatter:(params:unknown)=>{const index=(Array.isArray(params)?params[0]:params as {dataIndex?:number})?.dataIndex??0;return [`${dates[index]??''}　${coverageLabel(coverage[index])}`,...plotted.map(s=>`${s.name}：${raw?count(s.points[index]?.value):share(s.points[index]?.value)}${coverageTag(coverage[index])}`)].join('\n');}},
     xAxis:{type:'category',data:dates.map(chartTimeLabel),axisLabel:{hideOverlap:true,color:muted},axisLine:{lineStyle:{color:line}}},
     yAxis:raw?{type:'value',min:0,axisLabel:{color:muted,formatter:(v:number)=>compact(v)},splitLine:{lineStyle:{color:line}}}:{type:'value',min:0,max:100,axisLabel:{color:muted,formatter:(v:number)=>v.toFixed(1)+'%'},splitLine:{lineStyle:{color:line}}},
     series:plotted.flatMap((s,i)=>coverageSeries(s.name,s.points.map(p=>p.value),coverage,color(s.name,i)))},true);};
   render();resize=new ResizeObserver(()=>chart?.resize());resize.observe(ref.current);observer=new MutationObserver(render);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }
  void load().catch(()=>{if(!disposed)setFailed(true);});return()=>{disposed=true;resize?.disconnect();observer?.disconnect();chart?.dispose();};
 },[part,view,JSON.stringify(series),JSON.stringify(coverage),city]);
 if(!dates.length)return null;
 const partialNote=incomplete.length?incompleteCoverageNote(coverage):null;
 const period=`${dates[0]}～${dates[dates.length-1]}`;
 if(part==='chart')return <figure className={ui.panel+' mx-0 mt-0 mb-5'} aria-label="候選人媒體聲量占比趨勢">
   <figcaption className="space-y-1"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">{raw?`${unit}趨勢（七日合計）`:'媒體聲量占比趨勢'} <span className="text-sm font-normal text-zinc-500">{period}</span></h2>
    <div className="inline-flex rounded-md bg-zinc-100 p-0.5 text-sm dark:bg-zinc-800" role="group" aria-label="縱軸">{([['share','占比'],['raw','原始量']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={view===key} onClick={()=>setView(key)} className={'rounded px-2.5 py-1 '+(view===key?'bg-white font-medium shadow-sm dark:bg-zinc-700':'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100')}>{label}</button>)}</div></div>
    {partialNote?<CoverageDisclosure coverage={coverage}/>
     :<p className="text-xs text-zinc-500">圖中每個日期的七日範圍皆涵蓋 {MAYOR_EXPECTED_BUCKETS}/{MAYOR_EXPECTED_BUCKETS} 個分類日桶。</p>}
   </figcaption>
   {failed?<p className="py-8 text-center text-sm text-zinc-500">圖表載入失敗，請參考下方數值表格。</p>:<div ref={ref} role="img" aria-label={`候選人${raw?unit+'七日合計':'媒體聲量占比'}趨勢，${period}。${partialNote??'各日期涵蓋完整。'}`} className="h-80 w-full lg:h-[28rem]"/>}
  </figure>;
 return <section className="space-y-3" aria-label="候選人媒體聲量占比">
  <p role="status" className={`inline-flex rounded-full px-2.5 py-0.5 text-xs ${lastCoverage?.status==='complete'?'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300':'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>{last?dates[last.index]:''} {coverageLabel(lastCoverage)}</p>
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{series.map((s,i)=>{
   const date=last?dates[last.index]:undefined,trend=new URLSearchParams({tagid:MAYOR_TAGIDS,tags:s.name});
   for(const key of ['type','days','from','to'])if(one(key))trend.set(key,one(key)!);
   return <article key={s.name} className={ui.panel+' space-y-3'}>
    <div className="flex items-center justify-between"><Link className="font-semibold hover:underline" href={`/mayor/cities/${encodeURIComponent(city)}/people/${encodeURIComponent(s.name)}`}>{s.name}</Link><span className="size-2.5 rounded-full" style={{background:color(s.name,i)}} aria-hidden="true"/></div>
    <div className="grid grid-cols-2 gap-2"><div><strong className="block text-lg tabular-nums">{share(last?shares[i].points[last.index].value:null)}</strong><small className="text-xs text-zinc-500">{date??''} 媒體聲量占比{coverageTag(lastCoverage)}</small></div>
     <div><strong className="block text-lg tabular-nums">{last&&s.points[last.index]?.value!==null&&s.points[last.index]?.value!==undefined?count(s.points[last.index].value!):'n/a'}</strong><small className="text-xs text-zinc-500">近 7 日{s.unit}</small></div></div>
    <div className="flex flex-wrap gap-2 text-sm"><Link className="rounded-md border border-zinc-300 px-2.5 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" href={`/mayor/cities/${encodeURIComponent(city)}/people/${encodeURIComponent(s.name)}`}>每日 Dashboard</Link>
     <Link className="rounded-md border border-zinc-300 px-2.5 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" href={`/tags/compare?${trend}`}>關鍵字趨勢</Link></div>
   </article>;})}</div>
 </section>;
}

/** Region grouping and quick ranges from the Laravel mayor page. */
const REGIONS:[string,string[]][]=[['北部',['taipei','newtaipei','taoyuan','keelung','hsinchu','hsinchucounty','yilan']],['中部',['taichung','miaoli','changhua','nantou','yunlin']],['南部',['tainan','kaohsiung','chiayi','chiayicity','pingtung']],['東部',['hualien','taitung']],['離島',['penghu','kinmen','lienchiang']]];
const PERIODS:[number,string][]=[[7,'一週'],[10,'十天'],[30,'一個月'],[60,'兩個月'],[90,'一季']];
const METRICS:[string,string][]=[['tags_views','觀看引用'],['tags_video','影片引用'],['tags_result','重要度']];

export function MayorSwitcher({city,search}:{city:string;search:Record<string,string|string[]|undefined>}){
 const one=(key:string)=>{const value=search[key];return Array.isArray(value)?value[0]:value;};
 const href=(key:string,params:Record<string,string|undefined>)=>{const query=new URLSearchParams();for(const [k,v] of Object.entries(params))if(v)query.set(k,v);const text=query.toString();return `/mayor/cities/${encodeURIComponent(key)}${text?'?'+text:''}`;};
 const type=one('type'),days=one('days'),explicit=Boolean(one('from')||one('to')||one('today'));
 const base='rounded-md px-2.5 py-1 text-sm',idle=base+' text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',active=base+' bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900';
 const chip=(on:boolean,label:string,to:string)=><Link key={to+label} href={to} aria-current={on?'page':undefined} className={on?active:idle}>{label}</Link>;
 return <div className="space-y-3">
  <nav aria-label="縣市" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{REGIONS.map(([label,keys])=><div key={label} className="px-1 py-1"><p className="mb-1 px-1 text-xs font-semibold text-zinc-500">{label}</p><div className="flex flex-wrap gap-1">{keys.filter(key=>cities[key]).map(key=>chip(key===city,cities[key].label,href(key,{type,days,from:one('from'),to:one('to'),today:one('today')})))}</div></div>)}</nav>
  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
   <nav aria-label="日期範圍" className="flex flex-wrap gap-1">{PERIODS.map(([value,label])=>chip(!explicit&&Number(days||30)===value,label,href(city,{type,days:String(value)})))}</nav>
   <nav aria-label="指標" className="flex flex-wrap items-center gap-1 border-zinc-300 sm:border-l sm:pl-4 dark:border-zinc-700">{METRICS.map(([value,label])=>chip((type||'tags_views')===value,label,href(city,{type:value,days,from:one('from'),to:one('to'),today:one('today')})))}
    <a href="#mayor-metrics" className="ml-1 whitespace-nowrap text-sm text-brand-700 hover:underline dark:text-brand-400">指標說明 ⓘ</a></nav>
  </div>
 </div>;
}
