import type {HomeExploration,HomeKeywordSummary} from '../../../api/src/contracts';
import {compact,count,dateTime} from './format';
import {heatLabel,rankingBasis,riseLabel,viewsSummary} from './keyword-ranking';
export {keywordCoverageLabel} from './keyword-ranking';
/** A homepage edition is source time, never request/render time. */
export function homeEdition(updatedAt:string|null,aiDate:string|null){
 for(const value of [updatedAt,aiDate]){if(!value)continue;const formatted=dateTime(value,true);if(formatted!=='未記錄')return `觀測資料 ${formatted}`;}
 return '持續觀察 YouTube 公共討論';
}
/** Non-published or unavailable keyword rows must not masquerade as current matches. */
export function visibleHomeKeywords(keywords:Pick<HomeExploration['keywords'],'status'|'rows'>){return keywords.status==='synchronized'?keywords.rows:[];}

export type KeywordWindow='today'|'week';
export type HomeKeywordRow=HomeKeywordSummary['rows'][number];
export const KEYWORD_WINDOWS:readonly {value:KeywordWindow;label:string}[]=[{value:'today',label:'今日'},{value:'week',label:'近七日'}];
export const DEFAULT_KEYWORD_WINDOW:KeywordWindow='week';
export const HOME_KEYWORD_RANKING=8;
const period=(window:KeywordWindow)=>window==='today'?'今日':'近七日';
/** Each window is its own independently ranked summary. API builds that predate
 * keywordToday omit it during a rolling deployment: that is unknown, never an empty day. */
export function homeKeywordSummary(exploration:Partial<Record<'keywords'|'keywordToday',unknown>>,window:KeywordWindow):HomeKeywordSummary|null{
 const value=window==='today'?exploration.keywordToday:exploration.keywords;
 if(!value||typeof value!=='object')return null;
 const summary=value as Partial<HomeKeywordSummary>;
 return Array.isArray(summary.rows)&&['synchronized','not-synchronized','unavailable'].includes(summary.status as string)?summary as HomeKeywordSummary:null;
}
/** Machine-readable state behind the message (marked as data-keyword-state). Only `empty` is a
 * confirmed successful read with no ranked rows in the stated scope; `unknown`, `unavailable`,
 * `not-synchronized`, `not-computed` (collected, a measured 0 matched) and `completion-unknown`
 * (collected, matched count not reported) never mean "none". */
export type KeywordStateKind='listed'|'empty'|'unknown'|'unavailable'|'not-synchronized'|'not-computed'|'completion-unknown';
/** A reported count: a non-negative safe integer. null, an omitted field or a malformed value is unknown, never 0. */
const reported=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
/** Rows to draw, or the one truthful sentence explaining why there are none. */
export function homeKeywordState(summary:HomeKeywordSummary|null,window:KeywordWindow):{rows:HomeKeywordRow[];message:string|null;kind:KeywordStateKind}{
 if(!summary)return {rows:[],kind:'unknown',message:`目前的資料服務尚未提供${period(window)}關鍵字摘要；狀態未知，不代表沒有相關影片。`};
 if(summary.status==='unavailable')return {rows:[],kind:'unavailable',message:`${period(window)}關鍵字觀測目前無法完整讀取。`};
 if(summary.status==='not-synchronized')return {rows:[],kind:'not-synchronized',message:'共同詞彙尚未同步，等待來源資料；目前無法比對影片。'};
 const rows=visibleHomeKeywords(summary).filter(r=>r.videoCount>0);
 if(rows.length)return {rows,kind:'listed',message:null};
 if(!reported(summary.sourceVideos))return {rows,kind:'unknown',message:`${period(window)}尚無可確認的比對結果。`};
 if(summary.sourceVideos===0)return {rows,kind:'empty',message:`${period(window)}尚無收錄的發布影片。`};
 // Completion count missing (null, omitted by an older build, or malformed): progress is unknown, not "none matched".
 if(!reported(summary.freshVideos))return {rows,kind:'completion-unknown',message:`${period(window)}收錄 ${count(summary.sourceVideos)} 支影片，完成比對的影片數未提供；比對進度未知，不代表沒有相關影片。`};
 if(summary.freshVideos===0)return {rows,kind:'not-computed',message:`${period(window)}收錄 ${count(summary.sourceVideos)} 支影片，尚無完成比對的影片；沒有比對資料不代表沒有相關影片。`};
 return {rows,kind:'empty',message:`${period(window)}已完成比對 ${count(summary.freshVideos)} 支影片，尚未出現共同詞彙。`};
}
/** Empty-row message for the lower 頻道分類觀測 band (categories after the top three). Rows are only
 * drawn for status 'available'; only that status may say "no records". 'unavailable' is a failed read,
 * and a missing/unrecognised status stays unknown — neither is ever presented as zero. */
export type CategoryBandStateKind='empty'|'unavailable'|'unknown';
export function homeCategoryBandState(status:unknown):{kind:CategoryBandStateKind;message:string}{
 if(status==='available')return {kind:'empty',message:'已列分類以外，尚無其他分類紀錄。'};
 if(status==='unavailable')return {kind:'unavailable',message:'分類統計目前無法讀取；不代表沒有分類紀錄。'};
 return {kind:'unknown',message:'分類統計狀態未知；不代表沒有分類紀錄。'};
}
function taipeiDay(value:string|null|undefined){
 if(!value)return null;const time=Date.parse(value);
 return Number.isFinite(time)?new Date(time+8*3600000).toISOString().slice(0,10):null;
}
/** The keyword video report filters by Taipei publication dates; keep the selected window's days. */
export function keywordVideosHref(term:string,summary:Pick<HomeKeywordSummary,'from'|'to'>|null){
 const base=`/keywords/${encodeURIComponent(term)}/videos`,from=taipeiDay(summary?.from),to=taipeiDay(summary?.to);
 return from&&to&&from<=to?`${base}?from=${from}&to=${to}`:base;
}
export function keywordRangeLabel(summary:Pick<HomeKeywordSummary,'from'|'to'>,window:KeywordWindow){
 return `${window==='today'?'今日':'近七個日曆日'}發布：${dateTime(summary.from)} 至 ${dateTime(summary.to)}`;
}
export function keywordUpdatedLabel(summary:Pick<HomeKeywordSummary,'updatedAt'>){return summary.updatedAt?`比對更新 ${dateTime(summary.updatedAt)}`:'比對更新時間未記錄';}
export function vocabularyCoverageLabel(summary:Pick<HomeKeywordSummary,'vocabularyCoverage'>|null){
 return summary?.vocabularyCoverage==='observed-article-window'?'目前詞彙取自上游文章觀測窗口，不代表完整詞庫。':summary?.vocabularyCoverage==='all-current-indexed-article-tags'?'目前使用上游已索引的完整標籤快照。':'共同詞彙目前尚無可確認的同步資料。';
}
/** Current cumulative views of the window's videos; null stays unknown, never zero. */
export function keywordViewsLabel(row:Pick<HomeKeywordRow,'views'|'unknownViewVideos'>){
 return row.views===null?`無觀看值（${count(row.unknownViewVideos)} 支）`:`${compact(row.views)} 次${row.unknownViewVideos>0?`（另 ${count(row.unknownViewVideos)} 支無觀看值）`:''}`;
}
/** Every ranked term (at most forty) in API order, sized by heat; builds without the
 * weighted method keep sizing by matched video count and say so. */
export function homeKeywordCloudWords(rows:HomeKeywordRow[],summary:HomeKeywordSummary,window:KeywordWindow){
 const range=keywordRangeLabel(summary,window),ranked=rows.filter(r=>r.videoCount>0),heat=rankingBasis(summary,ranked)==='heat';
 return ranked.map((r,i)=>({label:r.term,count:heat?r.heatScore:r.videoCount,href:keywordVideosHref(r.term,summary),ariaLabel:heat?`${r.term}，${period(window)}熱度 ${heatLabel(r)}，${count(r.videoCount)} 支已比對影片`:`${r.term}，${period(window)} ${count(r.videoCount)} 支已比對影片`,tone:i<3?'brand' as const:'strong' as const,card:{rows:(heat
  ?[['熱度',heatLabel(r)],['升溫',riseLabel(r,summary).text],['影片',`${count(r.videoCount)} 支・${count(r.channelCount)} 個頻道`],['目前累計觀看',viewsSummary(r)],['範圍',range]]
  :[['影片',`${count(r.videoCount)} 支`],['目前累計觀看',keywordViewsLabel(r)],['範圍',range],['比對','共同詞彙比對標題與說明']]) as [string,string][]}}));
}
