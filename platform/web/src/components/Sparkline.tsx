import {sparklineRuns} from '@/lib/keyword-ranking';

/** Direction of a series from its first to its last observed value (a change under 2% is flat). */
export function seriesDirection(values:(number|null)[]):'up'|'down'|'flat'|'none'{
 const seen=values.filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
 if(seen.length<2)return 'none';
 const first=seen[0]!,last=seen.at(-1)!,change=(last-first)/Math.max(Math.abs(first),1);
 return change>0.02?'up':change<-0.02?'down':'flat';
}
/** Rising lines carry the brand red; falling and flat lines stay neutral, so red reads as 「升溫」. */
export const DIRECTION_TEXT={up:'text-brand-700 dark:text-brand-400',down:'text-zinc-500 dark:text-zinc-400',flat:'text-zinc-500 dark:text-zinc-400',none:'text-zinc-500 dark:text-zinc-400'} as const;
/** tag.observe.tw Sparkline: decorative, no chart runtime or hydration. Colour follows
 * currentColor; callers colour it by direction (DIRECTION_TEXT). */
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
