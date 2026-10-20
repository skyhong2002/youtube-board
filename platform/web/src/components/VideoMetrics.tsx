import {compact,count} from '@/lib/format';

/** The views / likes / comments line under a video in divided lists. A video not yet observed
 * says so once instead of three 「—」; a single missing count stays 「—」, never 0. */
export function VideoMetrics({views,likes,comments,commentsLabel='留言'}:{views:number|null;likes:number|null;comments:number|null;commentsLabel?:string}){
 if(views===null&&likes===null&&comments===null)return <p className="text-xs text-zinc-500 dark:text-zinc-400" data-video-metrics="none">尚未取得觀看數據</p>;
 return <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{[['累計觀看',compact(views)],['喜歡',count(likes)],[commentsLabel,count(comments)]].map(([label,value])=><div className="flex gap-1" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
