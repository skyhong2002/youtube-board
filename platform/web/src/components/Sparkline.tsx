import {sparklineRuns} from '@/lib/keyword-ranking';

/** tag.observe.tw Sparkline: decorative, no chart runtime or hydration. Colour follows
 * currentColor so the YouTube board's brand red applies in light and dark themes. */
export default function Sparkline({values,className='h-8 w-24'}:{values:(number|null)[];className?:string}){
 return <svg viewBox="0 0 96 32" preserveAspectRatio="none" className={className} aria-hidden="true" focusable="false">
  {sparklineRuns(values).map(run=>{
   const points=run.map(([x,y])=>`${x},${y}`).join(' ');
   return <g key={run[0]![0]}>
    {run.length>1&&<polygon points={`${run[0]![0]},30 ${points} ${run.at(-1)![0]},30`} fill="currentColor" opacity="0.12"/>}
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke"/>
    {run.length===1&&<circle cx={run[0]![0]} cy={run[0]![1]} r="2" fill="currentColor"/>}
   </g>;
  })}
 </svg>;
}
