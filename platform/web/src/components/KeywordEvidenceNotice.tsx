import Link from 'next/link';
import type {ReportMeta} from '@/lib/api';
import {count} from '@/lib/format';
import {reportStyle as ui} from '@/lib/report-styles';

export interface KeywordEvidenceNoticeProps {
 coverage: ReportMeta['coverage'];
 subject: string;
 scopeLabel?: string;
 /** Status, version, every count and the scope explanation only; the caller carries the
  * source attribution and methodology (e.g. in its MethodDisclosure). */
 compact?: boolean;
 /** Rows the caller is actually showing on this page; omitted when the caller lists nothing. */
 visibleCount?: number|null;
 /** The caller's known result total for the current filters; null or omitted when not counted. */
 total?: number|null;
}

const safeCount=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;

/** Scope counts describe collected videos, not all videos available on YouTube. */
export function KeywordEvidenceNotice({coverage,subject,scopeLabel='目前篩選範圍',compact=false,visibleCount,total}:KeywordEvidenceNoticeProps){
 const metric=(key:string)=>safeCount(coverage[key]);
 const source=metric('sourceVideos'),fresh=metric('freshVideos'),stale=metric('staleVideos'),unprocessed=metric('unprocessedVideos'),matched=metric('keywordMatchedVideos');
 const version=typeof coverage.vocabularyVersion==='string'&&coverage.vocabularyVersion.trim()?coverage.vocabularyVersion:null;
 const synchronized=coverage.status==='synchronized',notSynchronized=coverage.status==='not-synchronized';
 const complete=synchronized&&version!==null&&source!==null&&fresh===source&&stale===0&&unprocessed===0&&matched!==null&&matched<=source;
 const shown=safeCount(visibleCount),known=safeCount(total);
 // Listed rows or a positive counted total are results; the coverage wording must not call them empty.
 const listed=(shown??0)>0||(known??0)>0,pageEmpty=shown===0&&(known??0)>0;
 const partial=synchronized&&((stale??0)>0||(unprocessed??0)>0);
 let explanation='比對涵蓋範圍未完整提供，無法確認空列表是否代表沒有符合標籤的影片。';
 if(listed){
  if(notSynchronized)explanation='共同詞彙尚未同步，列出的結果可能不是目前版本，也可能不完整。';
  else if(partial)explanation='結果可能不完整，另有來源尚未比對或文字已變動；請參考上方涵蓋數量。';
  else if(complete&&matched!==null&&matched>0)explanation='已收錄的來源影片皆已完成目前版本比對；下方只列出符合這個共同標籤的影片。';
  else if(complete)explanation='上方涵蓋數量與列出的結果不一致，請以列出的影片為準；不能用來推算整體數量。';
  else explanation='比對涵蓋範圍未完整提供，列出的結果可能不完整；不能用來推算整體數量。';
 }
 else if(notSynchronized)explanation='共同詞彙尚未同步，空列表不代表沒有相關影片。';
 else if(complete&&source===0)explanation=`${scopeLabel}沒有已收錄影片；不代表 YouTube 沒有相關內容。`;
 else if(complete&&matched===0)explanation='已收錄的來源影片皆已完成有效比對，目前沒有符合這個共同標籤的影片。';
 else if(partial)explanation=matched!==null&&matched>0?'結果可能不完整，另有來源尚未比對或文字已變動；請參考上方涵蓋數量。':'部分來源尚未完成目前版本比對，空列表不能視為沒有相關影片。';
 else if(complete)explanation='已收錄的來源影片皆已完成目前版本比對；下方只列出符合這個共同標籤的影片。';
 // Only counts the caller supplied; nothing is derived from coverage.
 const results=pageEmpty?`這一頁沒有可呈現的影片，但目前條件共 ${count(known!)} 部符合；請改看其他頁碼。`:listed?[known!==null?`目前條件共 ${count(known)} 部符合`:null,shown!==null&&shown>0?`本頁顯示 ${count(shown)} 部`:null].filter(Boolean).join('・')+'。':null;
 const metrics=[['來源影片',source],['有效比對',fresh],['來源文字已變動',stale],['尚未比對',unprocessed],['符合標籤',matched]] as const;
 const status=`詞彙狀態：${synchronized?'已同步':notSynchronized?'尚未同步':'未提供'} · 版本：${version??'未提供'}`;
 if(compact)return <aside className={`${ui.note} [overflow-wrap:anywhere]`} aria-label="共同標籤比對範圍">
  <dl className="flex flex-wrap gap-x-4 gap-y-0.5">{metrics.map(([label,value])=><div className="flex gap-1" key={label}><dt>{label}</dt><dd>{value===null?'未提供':`${count(value)} 部`}</dd></div>)}</dl>
  {results&&<p className="mt-1" data-keyword-results={pageEmpty?'page-empty':'listed'}>{results}</p>}
  <p className="mt-1">{explanation}</p>
  <p className="mt-1 break-words text-xs">{status}</p>
 </aside>;
 return <aside className={`${ui.note} [overflow-wrap:anywhere]`} aria-label="共同標籤比對範圍">
  <p><strong>共同標籤「{subject}」</strong>來自 <Link className={ui.link} href="/vocabulary">新文易數共同詞彙</Link>，與頻道分類分開；文字命中不代表事件歸屬或立場。</p>
  <p className="break-words">{status}</p>
  <p>{scopeLabel}：</p>
  <dl className="my-1 flex flex-wrap gap-x-5 gap-y-1">{metrics.map(([label,value])=><div className="flex gap-1" key={label}><dt>{label}</dt><dd>{value===null?'未提供':`${count(value)} 部`}</dd></div>)}</dl>
  {results&&<p data-keyword-results={pageEmpty?'page-empty':'listed'}>{results}</p>}
  <p>{explanation}</p>
  <p>僅列出目前版本與影片標題、描述仍相符的比對結果；待比對或來源文字已變動的影片不會列入結果。</p>
 </aside>;
}
