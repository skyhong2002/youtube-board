export type TableScrollPosition='none'|'start'|'middle'|'end';

/** Optional mobile guidance for wide comparison matrices. No geometry is guessed
 * during SSR: only an actually measured overflow receives a scrolling hint. */
export function TableScrollHint({position,allSizes=false}:{position:TableScrollPosition|undefined;allSizes?:boolean}){
 if(position===undefined||position==='none')return null;
 return <p className={'px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400'+(allSizes?'':' sm:hidden')}>左右捲動表格可查看其餘欄位。</p>;
}
