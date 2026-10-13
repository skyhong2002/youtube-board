export type TableScrollPosition='none'|'start'|'middle'|'end';

/** Optional mobile guidance for wide comparison matrices. No geometry is guessed
 * during SSR: only an actually measured overflow receives a scrolling hint. */
export function TableScrollHint({position}:{position:TableScrollPosition|undefined}){
 if(position===undefined||position==='none')return null;
 return <p className="px-3 py-1.5 text-xs text-zinc-500 sm:hidden dark:text-zinc-400">左右滑動表格可查看其餘欄位。</p>;
}
