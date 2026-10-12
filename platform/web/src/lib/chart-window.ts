import {dateTime} from './format';
export interface ChartWindow {start:number;end:number}
/** Chart point label: a UTC/offset instant (hourly series) in Asia/Taipei; date-only and other labels as given. */
export const chartTimeLabel=(time:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(time)?dateTime(time):time;
export function chartWindow(total:number,start=0,end=total-1):ChartWindow{const last=Math.max(0,total-1),a=Math.max(0,Math.min(last,Math.round(Number.isFinite(start)?start:0))),b=Math.max(a,Math.min(last,Math.round(Number.isFinite(end)?end:last)));return {start:a,end:b};}
export function moveChartWindow(total:number,range:ChartWindow,direction:-1|1):ChartWindow{const width=range.end-range.start+1,start=Math.max(0,Math.min(Math.max(0,total-width),range.start+direction*width));return chartWindow(total,start,start+width-1);}
