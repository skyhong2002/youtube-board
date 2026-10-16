import type {Search} from '@/lib/api';
import {reportStyle as ui} from '@/lib/report-styles';
import {taipeiCalendarDate} from '@/lib/format';
const day=(raw:string|undefined)=>taipeiCalendarDate(raw);
export function ComparisonControls({search,points}:{search:Search;points?:{time:string}[]}){
 const value=(key:string,fallback='')=>typeof search[key]==='string'?search[key]:fallback;
 const ambiguous=['tags','from','to','type'].some(key=>Array.isArray(search[key]));
 const hidden=(keys:string[])=>keys.flatMap(key=>(Array.isArray(search[key])?search[key]:typeof search[key]==='string'?[search[key]]:[]).map((raw,i)=><input key={`${key}-${i}`} type="hidden" name={key} value={raw}/>));
 if(ambiguous)return <form action="/tags/compare" className={ui.form}>{hidden(Object.keys(search))}<p role="alert">比較條件含有重複參數，已保留原值。請清除後重新設定。</p><a className={ui.button} href="/tags/compare">清除後重設比較</a></form>;
 const aliases:Record<string,string>={tags_view:'tags_views',total_views:'tags_views',count_videos:'tags_video'},metric=aliases[value('type')]??value('type','tags_views');
 const from=day(value('from'))||day(points?.[0]?.time),to=day(value('to'))||day(points?.[points.length-1]?.time);
 return <form key={JSON.stringify([search,from,to])} action="/tags/compare" className={ui.form}>
  <label className={ui.label}>比較詞彙（以逗號分隔，最多 12 個）<input className={ui.input} name="tags" maxLength={2048} defaultValue={value('tags','蔡英文,柯文哲,賴清德,侯友宜')}/></label>
  <label className={ui.label}>開始日期<input className={ui.input} type="date" name="from" defaultValue={from} disabled={!from} required={!!from}/></label>
  <label className={ui.label}>結束日期<input className={ui.input} type="date" name="to" defaultValue={to} disabled={!to} required={!!to}/></label>
  <label className={ui.label}>度量<select className={ui.input} name="type" defaultValue={metric}><option value="tags_views">觀看引用</option><option value="tags_video">影片引用</option><option value="tags_result">重要度</option></select></label>
  {hidden(['tagid','or','not'])}<button className={ui.primary}>套用比較</button>
 </form>;
}
