import {TimeChart,type ChartPoint} from './Charts';
import {count} from '@/lib/format';
import {chartTimeLabel} from '@/lib/chart-window';

/** Valid observations a chart could draw; null and non-finite values are gaps, not points. */
export const observedPoints=(points:ChartPoint[])=>points.filter(p=>p.value!==null&&Number.isFinite(p.value));

/** For the page's method block (ReportMethod notes) when a chart shows a single observation. */
export const SINGLE_OBSERVATION_NOTE='時間序列只有一筆有效觀測時，只列出該值與觀測時間，不畫走勢圖；累積兩筆以上才畫圖。';

/** A video time series in its panel. One valid observation has no line to draw, so it shows the
 * value and its time instead of a full chart; two or more (or none) keep TimeChart. */
export function ObservationChart({points,label,unit}:{points:ChartPoint[];label:string;unit:string}){
 const observed=observedPoints(points);
 if(observed.length===1){const [point]=observed;return <div className="inline-flex min-w-48 flex-col rounded-xl border border-zinc-300 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900" role="group" data-observation="single" aria-label={label}>
  <div className="text-xs text-zinc-600 dark:text-zinc-400">目前僅一筆觀測 · <time dateTime={point!.time}>{chartTimeLabel(point!.time)}</time></div>
  <div className="mt-1 text-xl font-semibold tabular-nums leading-tight">{count(point!.value)}<span className="ml-1 text-sm font-normal text-zinc-500">{unit}</span></div>
 </div>;}
 return <div className="panel"><TimeChart points={points} label={label} unit={unit}/></div>;
}
