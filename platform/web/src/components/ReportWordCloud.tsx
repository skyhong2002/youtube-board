import Link from 'next/link';
import {count} from '@/lib/format';
import {reportLinkPrefetch,safeReportHref,type ReportData} from '@/lib/report-contract';
import {reportStyle as ui} from '@/lib/report-styles';

type Word=NonNullable<ReportData['words']>[number];
export const CLOUD_VISIBLE_WORDS=60;
const MIN_PX=13,MAX_PX=30;
const weightOf=(word:Word)=>Number.isFinite(word.weight)&&word.weight>0?word.weight:0;

/** Heaviest words first; only the first `visible` are drawn as the cloud, the rest go in a list.
 * Font size grows with the square root of the weight between the lightest and heaviest drawn
 * word, so the whole 13–30px range is used whatever the weights' unit. */
export function wordCloudLayout(words:Word[],visible=CLOUD_VISIBLE_WORDS){
 const sorted=words.map((word,index)=>({word,index})).sort((a,b)=>weightOf(b.word)-weightOf(a.word)||a.index-b.index).map(({word})=>word);
 const shown=sorted.slice(0,visible),roots=shown.map(word=>Math.sqrt(weightOf(word)));
 const lo=Math.min(...roots),hi=Math.max(...roots);
 return {
  shown:shown.map((word,i)=>{
   const t=hi>lo?(roots[i]!-lo)/(hi-lo):.5;
   return {word,fontSize:Math.round((MIN_PX+(MAX_PX-MIN_PX)*t)*10)/10,tier:t>=.6?'top' as const:t>=.25?'mid' as const:'low' as const};
  }),
  rest:sorted.slice(visible),
 };
}
const tierClass={
 top:'font-semibold text-brand-700 dark:text-brand-400',
 mid:'font-medium text-zinc-900 dark:text-zinc-100',
 low:'text-zinc-600 dark:text-zinc-400',
};
function Term({word,className,fontSize}:{word:Word;className:string;fontSize?:number}){
 const href=safeReportHref(word.href),style=fontSize?{fontSize}:undefined,weight=count(word.weight);
 const text=<>{word.term}<span className="sr-only">（權重 {weight}）</span></>;
 return href
  ?<Link href={href} prefetch={reportLinkPrefetch(href)} className={className+' rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'} style={style} title={`${word.term}：${weight}`}>{text}</Link>
  :<span className={className} style={style} title={`${word.term}：${weight}`}>{text}</span>;
}
/** 關鍵詞分布: the heaviest words as a cloud without numbers (weights stay in title and
 * accessible name); the long tail behind a native disclosure. */
export function ReportWordCloud({words}:{words:Word[]}){
 const {shown,rest}=wordCloudLayout(words);
 return <section className={ui.panel} aria-label="關鍵詞分布">
  <ul role="list" className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1.5 py-2 leading-tight">
   {shown.map(({word,fontSize,tier},index)=><li key={`${word.term}-${index}`}><Term word={word} fontSize={fontSize} className={tierClass[tier]}/></li>)}
  </ul>
  {rest.length?<details className="group mt-3 border-t border-zinc-200 pt-1 text-sm dark:border-zinc-800">
   <summary className="cursor-pointer py-3 text-zinc-600 dark:text-zinc-400"><span className="group-open:hidden">顯示其餘 {count(rest.length)} 個詞</span><span className="hidden group-open:inline">收起其餘 {count(rest.length)} 個詞</span></summary>
   <ul role="list" className="flex flex-wrap gap-x-3 gap-y-1 pb-1">
    {rest.map((word,index)=><li key={`${word.term}-${index}`}><Term word={word} className="text-zinc-600 dark:text-zinc-400"/></li>)}
   </ul>
  </details>:null}
 </section>;
}
