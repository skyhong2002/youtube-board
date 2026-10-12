'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {cities} from '../../../shared/city-definitions';
import {chartTimeLabel} from '@/lib/chart-window';
import {count} from '@/lib/format';
import {reportStyle as ui} from '@/lib/report-styles';
import type {ChartPoint} from './Charts';

/** Bloc colours follow the Laravel mayor page palette (KMT blue, DPP green, TPP cyan, others purple). */
const BLOC_COLORS:Record<string,string>={blue:'#2563eb',green:'#16a34a',white:'#0891b2',other:'#7c3aed'};
const FALLBACK=['#2563eb','#16a34a','#64748b','#0891b2','#7c3aed','#be123c'];
const MAYOR_TAGIDS='3,4,5,6';
type Series={name:string;unit:string;points:ChartPoint[]};

/** Same-day share across the listed candidates; mirrors the API's `{candidate}：占比` columns. */
export function mayorShares(series:Series[]){
 const length=Math.max(0,...series.map(s=>s.points.length));
 return series.map(s=>({name:s.name,points:Array.from({length},(_,i)=>{
  const values=series.map(other=>other.points[i]?.value);
  if(values.every(v=>v===null||v===undefined||!Number.isFinite(v)))return {time:s.points[i]?.time??'',value:null};
  const total=values.reduce<number>((sum,v)=>sum+(v??0),0),own=s.points[i]?.value??0;
  return {time:s.points[i]?.time??series.find(o=>o.points[i])?.points[i].time??'',value:total>0.000001?own/total*100:0};
 })}));
}
const share=(value:number|null|undefined)=>value===null||value===undefined?'n/a':value.toFixed(1)+'%';

export function MayorShare({city,series,search}:{city:string;series:Series[];search:Record<string,string|string[]|undefined>}){
 const blocs=cities[city]?.candidates??{},color=(name:string,index:number)=>BLOC_COLORS[blocs[name]??'']??FALLBACK[index%FALLBACK.length];
 const shares=mayorShares(series),dates=shares[0]?.points.map(p=>p.time)??[];
 const latest=(points:ChartPoint[])=>{for(let i=points.length-1;i>=0;i--)if(points[i].value!==null)return {index:i,point:points[i]};return undefined;};
 const last=latest(shares[0]?.points??[]),one=(key:string)=>{const value=search[key];return Array.isArray(value)?value[0]:value;};
 const ref=useRef<HTMLDivElement>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{if(!dates.length)return;let disposed=false,chart:import('echarts').ECharts|undefined,resize:ResizeObserver|undefined,observer:MutationObserver|undefined;
  async function load(){const echarts=await import('echarts');if(disposed||!ref.current)return;chart=echarts.init(ref.current,undefined,{renderer:'svg'});
   const render=()=>{const style=getComputedStyle(document.documentElement),muted=style.getPropertyValue('--muted').trim(),line=style.getPropertyValue('--line').trim(),panel=style.getPropertyValue('--panel').trim(),fg=style.getPropertyValue('--foreground').trim();
    chart?.setOption({animation:false,aria:{enabled:true,label:{description:'候選人近 7 日媒體聲量占比趨勢'}},textStyle:{fontFamily:style.fontFamily,color:muted,fontSize:12},
     legend:{type:'scroll',left:0,right:0,top:0,textStyle:{color:muted,fontSize:12}},grid:{left:56,right:24,top:40,bottom:32},
     tooltip:{trigger:'axis',renderMode:'richText',confine:true,backgroundColor:panel,borderColor:line,textStyle:{color:fg,fontSize:12},valueFormatter:(v:unknown)=>typeof v==='number'?v.toFixed(2)+'%':'n/a'},
     xAxis:{type:'category',data:dates.map(chartTimeLabel),axisLabel:{hideOverlap:true,color:muted},axisLine:{lineStyle:{color:line}}},
     yAxis:{type:'value',min:0,max:100,axisLabel:{color:muted,formatter:(v:number)=>v.toFixed(1)+'%'},splitLine:{lineStyle:{color:line}}},
     series:shares.map((s,i)=>({name:s.name,type:'line',data:s.points.map(p=>p.value),connectNulls:false,showSymbol:false,lineStyle:{width:2.5,color:color(s.name,i)},itemStyle:{color:color(s.name,i)}}))},true);};
   render();resize=new ResizeObserver(()=>chart?.resize());resize.observe(ref.current);observer=new MutationObserver(render);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }
  void load().catch(()=>{if(!disposed)setFailed(true);});return()=>{disposed=true;resize?.disconnect();observer?.disconnect();chart?.dispose();};
 },[JSON.stringify(series),city]);
 if(!dates.length)return null;
 return <section className="space-y-3" aria-label="候選人媒體聲量占比">
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{series.map((s,i)=>{
   const date=last?dates[last.index]:undefined,trend=new URLSearchParams({tagid:MAYOR_TAGIDS,tags:s.name});
   for(const key of ['type','days','from','to'])if(one(key))trend.set(key,one(key)!);
   return <article key={s.name} className={ui.panel+' space-y-3'}>
    <div className="flex items-center justify-between"><Link className="font-semibold hover:underline" href={`/mayor/cities/${encodeURIComponent(city)}/people/${encodeURIComponent(s.name)}`}>{s.name}</Link><span className="size-2.5 rounded-full" style={{background:color(s.name,i)}} aria-hidden="true"/></div>
    <div className="grid grid-cols-2 gap-2"><div><strong className="block text-lg tabular-nums">{share(last?shares[i].points[last.index].value:null)}</strong><small className="text-xs text-zinc-500">{date??''} 媒體聲量占比</small></div>
     <div><strong className="block text-lg tabular-nums">{last&&s.points[last.index]?.value!==null&&s.points[last.index]?.value!==undefined?count(s.points[last.index].value!):'n/a'}</strong><small className="text-xs text-zinc-500">近 7 日{s.unit}</small></div></div>
    <div className="flex flex-wrap gap-2 text-sm"><Link className="rounded-md border border-zinc-300 px-2.5 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" href={`/mayor/cities/${encodeURIComponent(city)}/people/${encodeURIComponent(s.name)}`}>每日 Dashboard</Link>
     <Link className="rounded-md border border-zinc-300 px-2.5 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" href={`/tags/compare?${trend}`}>關鍵字趨勢</Link></div>
   </article>;})}</div>
  <figure className={ui.panel+' m-0'}>
   <figcaption><h2 className="text-base font-semibold">近 7 日媒體聲量占比趨勢</h2></figcaption>
   {failed?<p className="py-8 text-center text-sm text-zinc-500">圖表載入失敗，請參考下方數值表格。</p>:<div ref={ref} role="img" aria-label="候選人近 7 日媒體聲量占比趨勢" className="h-80 w-full"/>}
  </figure>
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
  <nav aria-label="縣市" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{REGIONS.map(([label,keys])=><div key={label} className={ui.panel+' !p-2'}><p className="mb-1 px-1 text-xs font-semibold text-zinc-500">{label}</p><div className="flex flex-wrap gap-1">{keys.filter(key=>cities[key]).map(key=>chip(key===city,cities[key].label,href(key,{type,days,from:one('from'),to:one('to'),today:one('today')})))}</div></div>)}</nav>
  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
   <nav aria-label="日期範圍" className="flex flex-wrap gap-1">{PERIODS.map(([value,label])=>chip(!explicit&&Number(days||30)===value,label,href(city,{type,days:String(value)})))}</nav>
   <nav aria-label="指標" className="flex flex-wrap gap-1 border-zinc-300 sm:border-l sm:pl-4 dark:border-zinc-700">{METRICS.map(([value,label])=>chip((type||'tags_views')===value,label,href(city,{type:value,days,from:one('from'),to:one('to'),today:one('today')})))}</nav>
  </div>
 </div>;
}
