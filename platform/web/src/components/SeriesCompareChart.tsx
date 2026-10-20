'use client';
import {useEffect,useRef,useState} from 'react';
import {chartTimeLabel} from '@/lib/chart-window';
import {compact,count} from '@/lib/format';
import {COMPARE_COLORS,COMPARE_MAX_SERIES} from '@/lib/series-compare';
import type {ChartPoint} from './Charts';
type Series={name:string;unit:string;points:ChartPoint[]};
/** /tags/compare: every compared term on one shared axis, so their levels and turns can be read
 * against each other. Colours follow the term's position in the request (never its rank); the
 * legend names every line, the tooltip lists every term, and the report's observation table below
 * is the value view for readers who cannot tell the hues apart. Missing days stay gaps, never zero. */
export function SeriesCompareChart({series,label}:{series:Series[];label:string}){
 const shown=series.slice(0,COMPARE_MAX_SERIES),dates=shown.reduce<string[]>((longest,s)=>s.points.length>longest.length?s.points.map(p=>p.time):longest,[]);
 const unit=shown[0]?.unit??'',ref=useRef<HTMLDivElement>(null),[failed,setFailed]=useState(false),key=JSON.stringify(shown);
 const observed=shown.some(s=>s.points.some(p=>p.value!==null&&Number.isFinite(p.value)));
 useEffect(()=>{if(!observed)return;setFailed(false);let disposed=false,chart:import('echarts').ECharts|undefined,resize:ResizeObserver|undefined,observer:MutationObserver|undefined;
  async function load(){const echarts=await import('echarts');if(disposed||!ref.current)return;chart=echarts.init(ref.current,undefined,{renderer:'svg'});
   const render=()=>{const root=document.documentElement,style=getComputedStyle(root),muted=style.getPropertyValue('--muted').trim(),line=style.getPropertyValue('--line').trim(),panel=style.getPropertyValue('--panel').trim(),fg=style.getPropertyValue('--foreground').trim(),colors=COMPARE_COLORS[root.dataset.theme==='dark'?'dark':'light'];
    chart?.setOption({animation:false,aria:{enabled:true,label:{description:`${label}：${shown.map(s=>s.name).join('、')}`}},textStyle:{fontFamily:style.fontFamily,color:muted,fontSize:12},
     legend:{type:'scroll',left:0,right:0,top:0,itemGap:16,textStyle:{color:fg,fontSize:12}},grid:{left:56,right:24,top:64,bottom:32},
     tooltip:{trigger:'axis',renderMode:'richText',confine:true,backgroundColor:panel,borderColor:line,textStyle:{color:fg,fontSize:12},
      formatter:(params:unknown)=>{const index=(Array.isArray(params)?params[0]:params as {dataIndex?:number})?.dataIndex??0;return [chartTimeLabel(dates[index]??''),...shown.map(s=>`${s.name}：${count(s.points[index]?.value)}`)].join('\n');}},
     xAxis:{type:'category',data:dates.map(chartTimeLabel),axisLabel:{hideOverlap:true,color:muted},axisLine:{lineStyle:{color:line}}},
     yAxis:{type:'value',min:0,name:unit,axisLabel:{color:muted,formatter:(v:number)=>compact(v)},splitLine:{lineStyle:{color:line}}},
     series:shown.map((s,i)=>({name:s.name,type:'line',data:s.points.map(p=>p.value),connectNulls:false,showSymbol:true,symbolSize:8,lineStyle:{width:2},itemStyle:{color:colors[i]}}))},true);};
   render();resize=new ResizeObserver(()=>chart?.resize());resize.observe(ref.current);observer=new MutationObserver(render);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }
  void load().catch(()=>{if(!disposed)setFailed(true);});return()=>{disposed=true;resize?.disconnect();observer?.disconnect();chart?.dispose();};
 // The series are keyed by content, so an equal payload does not rebuild the chart.
 },[key,label,observed]);
 if(!observed)return <p className="text-sm text-zinc-500">這個期間尚無有效觀測值。</p>;
 return <figure className="m-0 space-y-3">
  {failed?<p role="status" className="py-8 text-center text-sm text-zinc-500">圖表暫時無法顯示，請展開下方數值表格。</p>:<div ref={ref} role="img" aria-label={`${label}：${shown.map(s=>s.name).join('、')}，${dates[0]?chartTimeLabel(dates[0]):''}～${dates.length?chartTimeLabel(dates[dates.length-1]!):''}`} className="h-80 w-full lg:h-96"/>}
 </figure>;
}
