'use client';
import {useEffect,useRef,useState} from 'react';
import {ObservationValue} from './ObservationValue';
import {CoverageDisclosure} from './CoverageDisclosure';
import {chartTimeLabel,chartWindow,moveChartWindow,type ChartWindow} from '@/lib/chart-window';
import {table} from '@/lib/table-styles';
import TableScroller from './TableScroller';
import {coverageCount,incompleteCoverageNote,type BucketCoverage} from '@/lib/bucket-coverage';
import type {ECharts} from '@/lib/echarts';
import {timeChartOption,type ChartPoint} from '@/lib/time-chart-option';
export type {ChartPoint};
/** `coverage` (index-aligned with points) is optional and only given by /mayor: it splits the
 * line into solid complete and dashed/hollow incomplete parts and adds the coverage notes.
 * `compact` is for small multiples under their own heading: a shorter plot without the
 * one-entry legend that would repeat that heading. */
export function TimeChart({points,label,unit,coverage,compact=false}:{points:ChartPoint[];label:string;unit:string;coverage?:BucketCoverage[];compact?:boolean}){
 const note=coverage?incompleteCoverageNote(coverage):null,coverageKey=coverage?JSON.stringify(coverage):'';
 const ref=useRef<HTMLDivElement>(null),chartRef=useRef<ECharts|undefined>(undefined),[failed,setFailed]=useState(false),[range,setRange]=useState<ChartWindow>(()=>chartWindow(points.length)),current=useRef(range);
 current.current=range;
 const observed=points.filter(p=>p.value!==null&&Number.isFinite(p.value)).length;
 useEffect(()=>{setRange(chartWindow(points.length));},[points]);
 useEffect(()=>{
  if(!observed)return;
  setFailed(false);
  let disposed=false,chart:ECharts|undefined,resize:ResizeObserver|undefined,observer:MutationObserver|undefined;
  async function load(){
   const echarts=await import('@/lib/echarts');
   if(disposed||!ref.current)return;
   chart=echarts.init(ref.current,undefined,{renderer:'svg'});
   chartRef.current=chart;
   // Colours come from the theme's CSS variables, so the option is rebuilt when data-theme changes.
   const render=()=>{
    const style=getComputedStyle(document.documentElement);
    const theme={
     muted:style.getPropertyValue('--muted').trim(),
     line:style.getPropertyValue('--line').trim(),
     accent:style.getPropertyValue('--accent').trim(),
     panel:style.getPropertyValue('--panel').trim(),
     color:style.getPropertyValue('--foreground').trim(),
     fontFamily:style.fontFamily,
    };
    chart?.setOption(timeChartOption({points,label,unit,coverage,compact,window:current.current,theme}));
   };
   chart.on('datazoom',()=>{
    const zoom=(chart?.getOption().dataZoom as {startValue?:number;endValue?:number}[]|undefined)?.[0];
    if(!zoom)return;
    setRange(previous=>{
     const next=chartWindow(points.length,zoom.startValue,zoom.endValue);
     return next.start===previous.start&&next.end===previous.end?previous:next;
    });
   });
   render();
   resize=new ResizeObserver(()=>chart?.resize());
   resize.observe(ref.current);
   observer=new MutationObserver(render);
   observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }
  void load().catch(()=>{if(!disposed)setFailed(true);});
  return()=>{
   disposed=true;
   resize?.disconnect();
   observer?.disconnect();
   chart?.dispose();
   chartRef.current=undefined;
  };
 // Coverage is keyed by content: a new array with the same counts must not rebuild the chart.
 },[points,label,unit,observed,coverageKey,compact]);
 useEffect(()=>{chartRef.current?.dispatchAction({type:'dataZoom',startValue:range.start,endValue:range.end},{silent:true});},[range]);
 const width=range.end-range.start+1,button='rounded px-2.5 py-0.5 text-xs disabled:cursor-default disabled:opacity-40';
 // A window choice only when there is more than one; a short series shows whole and needs no controls.
 const sizes=[points.length,...(points.length>30?[30]:[]),...(points.length>7?[7]:[])];
 return <figure className="m-0 space-y-3">{observed>0?<>{sizes.length>1&&<div className="flex flex-wrap items-center justify-between gap-2"><div className="inline-flex rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="圖表顯示範圍">{sizes.map(size=><button type="button" key={size} aria-pressed={width===size&&range.end===points.length-1} className={button+' '+(width===size&&range.end===points.length-1?'bg-white font-medium shadow-sm dark:bg-zinc-700':'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100')} onClick={()=>setRange(chartWindow(points.length,points.length-size,points.length-1))}>{size===points.length?'全部':`最近 ${size} 點`}</button>)}</div><div className="flex items-center gap-2 text-xs text-zinc-500"><button type="button" className={button} aria-label="較早：顯示更早的觀測區間" disabled={range.start===0} onClick={()=>setRange(moveChartWindow(points.length,range,-1))}>← 較早</button><button type="button" className={button} aria-label="較新：顯示較新的觀測區間" disabled={range.end>=points.length-1} onClick={()=>setRange(moveChartWindow(points.length,range,1))}>較新 →</button></div></div>}<div ref={ref} className={compact?'h-56 w-full sm:h-60':'h-72 w-full sm:h-80'} role="img" aria-label={note?`${label}。${note}`:label}/><figcaption className="space-y-1 text-xs text-zinc-500"><p>{points[range.start]&&chartTimeLabel(points[range.start]!.time)} ～ {points[range.end]&&chartTimeLabel(points[range.end]!.time)}</p>{coverage&&<CoverageDisclosure coverage={coverage}/>}</figcaption></>:<p className="text-sm text-zinc-500">這個期間尚無有效觀測值。</p>}{failed&&<p role="status" className="text-sm text-zinc-500">圖表暫時無法顯示，請展開下方數值表格。</p>}
 <details className="text-xs text-zinc-600 dark:text-zinc-400"><summary className="cursor-pointer py-2">查看數值表格（{points.length} 個時點、{observed} 筆有效觀測）</summary><TableScroller label={label+'數值表格'}><table className={'w-full text-left text-sm '+table.nowrap}><thead className="text-xs"><tr><th className={table.cell}>觀測時間</th><th className={table.num}>{unit||"數值"}</th>{coverage&&<th className={table.num}>分類日桶</th>}</tr></thead><tbody>{points.map((point,index)=><tr className={table.row} key={`${point.time}-${index}`}><th scope="row" className={table.cell+" font-normal"}>{chartTimeLabel(point.time)}</th><td className={table.num}><ObservationValue value={point.value}/></td>{coverage&&<td className={table.num}>{coverageCount(coverage[index])}{coverage[index]?.status==='complete'||coverage[index]?.status==='provisional'?'':<small className="ml-1.5">{coverage[index]?.status==='partial'?'未完整':'涵蓋未知'}</small>}</td>}</tr>)}</tbody></table></TableScroller></details></figure>;
}
