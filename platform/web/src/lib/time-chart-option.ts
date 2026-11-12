import {chartTimeLabel,type ChartWindow} from './chart-window';
import {count} from './format';
import {coverageLabel,coverageSeries,coverageTag,type BucketCoverage} from './bucket-coverage';

export type ChartPoint={time:string;value:number|null};
/** Colours and font read from the page's CSS variables when the chart (re)draws. */
export type ChartTheme={muted:string;line:string;accent:string;panel:string;color:string;fontFamily:string};

/** The ECharts option for TimeChart: one line series (or /mayor's coverage-split parts), a
 * category time axis and a locked-width data window driven by the window buttons. */
export function timeChartOption({points,label,unit,coverage,compact,window,theme}:{
 points:ChartPoint[];
 label:string;
 unit:string;
 coverage?:BucketCoverage[];
 compact:boolean;
 window:ChartWindow;
 theme:ChartTheme;
}){
 const {muted,line,accent,panel,color,fontFamily}=theme;
 const long=points.length>7;
 // Both zoom components share the window; the reader moves it with the buttons, never by wheel or drag-resize.
 const range={xAxisIndex:0,startValue:window.start,endValue:window.end,rangeMode:['value','value'],zoomLock:true};
 // A /mayor tooltip names the date's coverage and marks incomplete values; others use ECharts' default.
 const coverageTooltip=coverage?{
  formatter:(params:unknown)=>{
   const index=(Array.isArray(params)?params[0]:params as {dataIndex?:number})?.dataIndex??0,point=points[index];
   return `${point?chartTimeLabel(point.time):''}　${coverageLabel(coverage[index])}\n${label}：${count(point?.value)}${coverageTag(coverage[index])}`;
  },
 }:{};
 return {
  animation:false,
  aria:{enabled:true,label:{description:label}},
  textStyle:{fontFamily,color:muted,fontSize:12},
  legend:{show:!compact,type:'scroll',left:0,right:0,top:0,data:[label],textStyle:{color:muted,fontSize:12}},
  grid:{left:48,right:24,top:compact?30:55,bottom:long?(compact?56:78):36},
  tooltip:{trigger:'axis',renderMode:'richText',confine:true,backgroundColor:panel,borderColor:line,textStyle:{color,fontSize:12},...coverageTooltip},
  xAxis:{type:'category',data:points.map(p=>chartTimeLabel(p.time)),axisLabel:{hideOverlap:true,color:muted},axisLine:{lineStyle:{color:line}}},
  yAxis:{type:'value',name:unit,axisLabel:{color:muted},splitLine:{lineStyle:{color:line}}},
  dataZoom:[
   {type:'inside',...range,zoomOnMouseWheel:false,moveOnMouseWheel:false,zoomOnMouseMove:false},
   {
    type:'slider',show:long,...range,brushSelect:false,showDataShadow:false,showDetail:false,
    height:8,bottom:8,borderColor:'transparent',borderRadius:4,
    backgroundColor:'rgba(113,113,122,0.08)',fillerColor:'rgba(113,113,122,0.24)',
    left:48,right:24,handleSize:0,
   },
  ],
  series:coverage
   ?[...coverageSeries(label,points.map(p=>p.value),coverage,accent)]
   :[{name:label,type:'line',data:points.map(p=>p.value),connectNulls:false,showSymbol:true,showAllSymbol:true,symbolSize:4,lineStyle:{width:2},itemStyle:{color:accent}}],
 };
}
