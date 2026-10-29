'use client';
import {useEffect,useRef,useState} from 'react';
import {chartTimeLabel} from '@/lib/chart-window';
import {compact,count} from '@/lib/format';
import {compareStyle,COMPARE_MAX_SERIES} from '@/lib/series-compare';
import type {ChartPoint} from './Charts';
type Series={name:string;unit:string;points:ChartPoint[]};
/** Every compared series on one shared axis, so their levels and turns can be read against each
 * other (/tags/compare terms, /live/trends/daily categories). Colours follow the series' position in
 * the request (never its rank), camp names keep their political colour, and a second pass over the
 * slots is dashed with triangle markers. Clicking a legend entry hides or shows that line, and the
 * 全選／反選 buttons flip them all; the choice survives theme changes and the tooltip lists only
 * visible lines. Four or fewer lines are also labelled at their ends. The report's observation table
 * below is the value view for readers who cannot tell the hues apart. Missing days stay gaps. */
export function SeriesCompareChart({series,label,max=COMPARE_MAX_SERIES}:{series:Series[];label:string;max?:number}){
 const shown=series.slice(0,max),dates=shown.reduce<string[]>((longest,s)=>s.points.length>longest.length?s.points.map(p=>p.time):longest,[]);
 const unit=shown[0]?.unit??'',ref=useRef<HTMLDivElement>(null),[failed,setFailed]=useState(false),key=JSON.stringify(shown);
 const observed=shown.some(s=>s.points.some(p=>p.value!==null&&Number.isFinite(p.value)));
 useEffect(()=>{if(!observed)return;setFailed(false);let disposed=false,chart:import('echarts').ECharts|undefined,resize:ResizeObserver|undefined,observer:MutationObserver|undefined,selected:Record<string,boolean>={};
  async function load(){const echarts=await import('echarts');if(disposed||!ref.current)return;chart=echarts.init(ref.current,undefined,{renderer:'svg'});
   const render=()=>{const root=document.documentElement,style=getComputedStyle(root),muted=style.getPropertyValue('--muted').trim(),line=style.getPropertyValue('--line').trim(),panel=style.getPropertyValue('--panel').trim(),fg=style.getPropertyValue('--foreground').trim(),theme=root.dataset.theme==='dark'?'dark':'light',labelled=shown.length<=4,
     // Wide screens wrap a long legend onto a second line so every category stays one click away; phones scroll it.
     wrap=shown.length>COMPARE_MAX_SERIES&&(ref.current?.clientWidth??0)>=900;
    chart?.setOption({animation:false,aria:{enabled:true,label:{description:`${label}：${shown.map(s=>s.name).join('、')}`}},textStyle:{fontFamily:style.fontFamily,color:muted,fontSize:12},
     legend:{type:wrap?'plain':'scroll',left:0,...(wrap?{width:(ref.current?.clientWidth??0)-120,selectorPosition:'start'}:{right:0}),top:0,itemGap:16,selected,textStyle:{color:fg,fontSize:12},inactiveColor:muted,selector:shown.length>2?[{type:'all',title:'全選'},{type:'inverse',title:'反選'}]:false,selectorLabel:{color:fg,borderColor:line}},grid:{left:56,right:labelled?72:24,top:wrap?92:64,bottom:32},
     tooltip:{trigger:'axis',renderMode:'richText',confine:true,backgroundColor:panel,borderColor:line,textStyle:{color:fg,fontSize:12},
      formatter:(params:unknown)=>{const index=(Array.isArray(params)?params[0]:params as {dataIndex?:number})?.dataIndex??0;return [chartTimeLabel(dates[index]??''),...shown.filter(s=>selected[s.name]!==false).map(s=>`${s.name}：${count(s.points[index]?.value)}`)].join('\n');}},
     xAxis:{type:'category',data:dates.map(chartTimeLabel),axisLabel:{hideOverlap:true,color:muted},axisLine:{lineStyle:{color:line}}},
     yAxis:{type:'value',min:0,name:unit,axisLabel:{color:muted,formatter:(v:number)=>compact(v)},splitLine:{lineStyle:{color:line}}},
     series:shown.map((s,i)=>{const look=compareStyle(s.name,i,theme);return {name:s.name,type:'line',data:s.points.map(p=>p.value),connectNulls:false,showSymbol:true,symbol:look.symbol,symbolSize:8,lineStyle:{width:2,type:look.dashed?'dashed':'solid'},itemStyle:{color:look.color},endLabel:{show:labelled,formatter:'{a}',color:fg,fontSize:12}};})},true);};
   render();
   // setOption(…,true) rebuilds the legend, so keep the reader's on/off choice and redraw with it.
   const remember=()=>{const legend=(chart?.getOption() as {legend?:{selected?:Record<string,boolean>}[]}|undefined)?.legend?.[0];selected={...legend?.selected};};
   for(const event of ['legendselectchanged','legendselectall','legendinverseselect'])chart.on(event,remember);
   // A width change can switch the legend between wrapped and scrolling, so redraw before resizing.
   resize=new ResizeObserver(()=>{render();chart?.resize();});resize.observe(ref.current);observer=new MutationObserver(render);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }
  void load().catch(()=>{if(!disposed)setFailed(true);});return()=>{disposed=true;resize?.disconnect();observer?.disconnect();chart?.dispose();};
 // The series are keyed by content, so an equal payload does not rebuild the chart.
 },[key,label,observed]);
 if(!observed)return <p className="text-sm text-zinc-500">這個期間尚無有效觀測值。</p>;
 return <figure className="m-0 space-y-3">
  {failed?<p role="status" className="py-8 text-center text-sm text-zinc-500">圖表暫時無法顯示，請展開下方數值表格。</p>:<div ref={ref} role="img" aria-label={`${label}：${shown.map(s=>s.name).join('、')}，${dates[0]?chartTimeLabel(dates[0]):''}～${dates.length?chartTimeLabel(dates[dates.length-1]!):''}`} className="h-80 w-full lg:h-96"/>}
 </figure>;
}
