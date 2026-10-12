export interface ChartWindow {start:number;end:number}
export function chartWindow(total:number,start=0,end=total-1):ChartWindow{const last=Math.max(0,total-1),a=Math.max(0,Math.min(last,Math.round(Number.isFinite(start)?start:0))),b=Math.max(a,Math.min(last,Math.round(Number.isFinite(end)?end:last)));return {start:a,end:b};}
export function moveChartWindow(total:number,range:ChartWindow,direction:-1|1):ChartWindow{const width=range.end-range.start+1,start=Math.max(0,Math.min(Math.max(0,total-width),range.start+direction*width));return chartWindow(total,start,start+width-1);}
