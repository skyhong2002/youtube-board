import type {HomeKeywordSummary} from '../../../api/src/contracts';
import {compact,count,dateTime} from './format';
/** Presentation of the effective-keyword ranking shared by /keywords, the homepage and
 * /vocabulary. Values come from the API as-is; anything missing is said to be missing. */
export type RankingRow=HomeKeywordSummary['rows'][number];
export type RankingBasis='heat'|'video-count';
export const TAG_SOURCE_ATTRIBUTION='標籤來源：新文易數（tag.observe.tw）';
export const INSUFFICIENT='資料不足';
/** A null view count is unknown: never 0 and never the lowest value in a views ordering. */
export const NO_VIEWS='無觀看值';
/** Text match only; no claim that quality filtering removed promotional or copyright passages. */
export const MATCH_CAVEAT='標題或說明出現標籤，不代表影片主題；可能來自固定宣傳或版權文字。';
export const viewsText=(views:number|null|undefined)=>typeof views==='number'&&Number.isFinite(views)?compact(views):NO_VIEWS;
/** Matched share of collected videos: how far matching has run, not a distortion rate. */
export function matchCoveragePercent(summary:Pick<HomeKeywordSummary,'freshVideos'|'sourceVideos'>){
 return finite(summary.freshVideos)&&finite(summary.sourceVideos)&&summary.sourceVideos>0?`${(summary.freshVideos/summary.sourceVideos*100).toFixed(2)}%`:null;
}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const oneDecimal=new Intl.NumberFormat('zh-TW',{minimumFractionDigits:1,maximumFractionDigits:1});

/** Heat only when the API names the weighted method and every row carries a score. Older
 * builds and raw-count fallbacks rank by matched videos and are never labelled as heat. */
export function rankingBasis(summary:Partial<Pick<HomeKeywordSummary,'rankingMethod'>>|null,rows:readonly Partial<RankingRow>[]):RankingBasis{
 return summary?.rankingMethod==='youtube-channel-weighted-decay-v1'&&rows.every(r=>finite(r.heatScore))?'heat':'video-count';
}
export function heatLabel(row:Partial<RankingRow>){return finite(row.heatScore)?oneDecimal.format(row.heatScore):INSUFFICIENT;}
/** Equal-duration heat delta, only when both periods reach the API's minimum matched share; never a zero stand-in. */
export function riseLabel(row:Partial<RankingRow>,summary:Partial<Pick<HomeKeywordSummary,'comparison'>>|null):{text:string;tone:'up'|'down'|'flat'|'missing'}{
 if(!summary?.comparison?.complete||!finite(row.rise))return {text:INSUFFICIENT,tone:'missing'};
 const rise=Math.round(row.rise*10)/10;
 return rise>0?{text:`+${oneDecimal.format(rise)}`,tone:'up'}:rise<0?{text:`−${oneDecimal.format(-rise)}`,tone:'down'}:{text:'±0',tone:'flat'};
}
/** Daily heat; days below the matched-share threshold stay null so the line breaks instead of dropping to zero. */
export function trendValues(trend:unknown):(number|null)[]{
 return Array.isArray(trend)?trend.map(p=>p&&typeof p==='object'&&finite((p as {heat?:unknown}).heat)?(p as {heat:number}).heat:null):[];
}
export function trendLabel(trend:unknown){
 const points=Array.isArray(trend)?trend.filter((p):p is {date:string;heat:number|null}=>!!p&&typeof p==='object'&&typeof (p as {date?:unknown}).date==='string'):[];
 return points.some(p=>finite(p.heat))?`每日熱度：${points.map(p=>`${p.date.slice(5)} ${finite(p.heat)?oneDecimal.format(p.heat):INSUFFICIENT}`).join('、')}`:`每日熱度：${INSUFFICIENT}`;
}
/** Separate runs keep missing samples as gaps (tag.observe.tw sparklineRuns, 96×32 box). */
export function sparklineRuns(values:readonly (number|null)[]){
 const known=values.filter((v):v is number=>finite(v)),max=Math.max(1,...known),runs:[number,number][][]=[];let run:[number,number][]=[];
 values.forEach((value,index)=>{
  if(!finite(value)){if(run.length)runs.push(run);run=[];return;}
  const x=2+(values.length<=1?46:index/(values.length-1)*92),y=30-value/max*26;
  run.push([Math.round(x*100)/100,Math.round(y*100)/100]);
 });
 if(run.length)runs.push(run);
 return runs;
}
/** Round DOWN before compact formatting, so the displayed lower bound cannot exceed
 * the measured subtotal. Ordinary compact() rounds to the nearest unit. */
const compactLowerBound=(value:number)=>compact(value>=1e8?Math.floor(value/1e6)*1e6:value>=1e4?Math.floor(value/100)*100:value);
/** A complete total is exact; a measured subtotal is a lower bound while missing videos
 * stay missing. Only an entirely unknown measurement reads 無觀看值. */
export function viewsCell(row:Partial<RankingRow>&Pick<RankingRow,'videoCount'|'views'|'unknownViewVideos'>):{value:string;detail:string|null;title:string}{
 if(finite(row.views))return {value:`${compact(row.views)} 次`,detail:null,title:`${count(row.videoCount)} 支影片目前累計觀看合計`};
 const missing=finite(row.measuredViewVideos)?Math.max(0,row.videoCount-row.measuredViewVideos):row.unknownViewVideos;
 const known=finite(row.measuredViewVideos)&&row.measuredViewVideos>0&&finite(row.knownViews)&&row.knownViews>=0?row.knownViews:null;
 return {value:known===null?NO_VIEWS:`≥${compactLowerBound(known)} 次`,detail:`${count(missing)} 支缺值`,
  title:known===null?`${count(missing)} 支影片無觀看值，合計無法計算，不當作 0`:`至少 ${count(known)} 次：已知小計只含有觀看值的 ${count(row.measuredViewVideos)} 支，另 ${count(missing)} 支缺值，不是完整合計`};
}
/** One-line text for places without a separate detail slot (word cloud card). */
export const viewsSummary=(row:Parameters<typeof viewsCell>[0])=>{const v=viewsCell(row);return v.detail?`${v.value}（${v.detail}）`:v.value;};
export function keywordCoverageLabel(summary:Pick<HomeKeywordSummary,'freshVideos'|'sourceVideos'|'unprocessedVideos'|'staleVideos'>){
 return `有效比對 ${count(summary.freshVideos)}／${count(summary.sourceVideos)} 支；待比對 ${count(summary.unprocessedVideos)} 支、來源文字已變動 ${count(summary.staleVideos)} 支`;
}
export function ruleVersionLabel(rule:unknown){return rule==='youtube-quality-v2'?'YouTube 品質規則 v2':rule==='exact-text-v1'?'舊版精確文字比對（過渡期）':'比對規則未提供';}
/** Upstream article window the vocabulary pool was built from, with its measured length. */
export function vocabularyPoolLabel(summary:Partial<Pick<HomeKeywordSummary,'vocabularyCoverage'|'vocabularyWindow'>>|null){
 const window=summary?.vocabularyWindow,since=window?Date.parse(window.since):NaN,until=window?Date.parse(window.until):NaN;
 if(summary?.vocabularyCoverage==='observed-article-window'){
  const span=Number.isFinite(since)&&Number.isFinite(until)&&until>since?`（約 ${count(Math.round((until-since)/3600000))} 小時）`:'';
  return `目前詞彙池取自上游${window?` ${dateTime(window.since)} 至 ${dateTime(window.until)}${span}`:''}文章時間窗內出現的標籤，不是新文易數全部歷史文章的完整標籤庫；時間窗外的詞不會進入排行。`;
 }
 if(summary?.vocabularyCoverage==='all-current-indexed-article-tags')return '目前詞彙池為上游已索引文章的標籤快照，仍不等於完整人工詞典。';
 return '詞彙池範圍目前未提供。';
}
export const TAG_DISPLAY_EXCLUSION_LABELS:Record<string,string>={
 'youtube-source-or-platform':'來源或平台名稱',
 'youtube-platform-or-promotion':'YouTube 平台或宣傳用語',
 'youtube-generic-two-character':'雙字通用詞（實際詞池稽核清單）',
 'youtube-generic-context':'通用角色或背景詞（實際詞池稽核清單）',
 'youtube-country-city-party':'國家、城市或政黨詞（補充排除清單）',
 'upstream-window-not-qualified':'未符合該期間新聞詞池的跨媒體門檻',
 'upstream-window-unavailable':'該期間新聞詞池目前無法驗證',
 'upstream-length':'長度不在 2–30 字',
 'upstream-no-equal-or-category':'新聞分類詞或上游排除詞',
 'upstream-tag-noise':'上游判定為雜訊標籤',
 'upstream-number-or-date':'純數字或日期',
 'upstream-nonword':'不含文字或數字',
 'admin-ranking-exclusion':'管理員從排行排除',
};
/** Two different mechanisms; keep them apart in every method note. */
export const DISPLAY_EXCLUSION_NOTE='顯示排除：符合標籤顯示規則的詞（上游排除詞、雜訊、純數字或日期、長度不符，以及核定的來源或平台名稱、雙字通用詞、國家城市政黨詞、少數 YouTube 平台或宣傳用語）整詞不列入排行，但仍保留在原始詞彙池與比對證據中；原始詞彙池列出排除原因。雙字通用詞只依核定清單判定，包含它們的人名、事件或具體議題不會因此被排除。管理員也可以在排行上直接排除個別標籤，同樣只影響排行顯示，每次排除與恢復都留有紀錄。';
export const DESCRIPTION_TEMPLATE_NOTE='說明欄樣板：同一頻道說明欄反覆出現的宣傳段落不列入比對。「24小時」這類詞只在這種重複宣傳段落中略過，出現在一般新聞內容時照常計入；這不同於整詞的顯示排除。';
export const exclusionReasonLabel=(code:string)=>TAG_DISPLAY_EXCLUSION_LABELS[code]??`其他顯示規則（${code}）`;
/** undefined = API without the field; null = eligible for the ranking. */
export function displayExclusionLabel(exclusion:string|null|undefined){return exclusion===undefined?'未提供':exclusion===null?'可列入排行':`不列入排行：${exclusionReasonLabel(exclusion)}`;}
/** 「本頁資料來源與計算方式」 for one ranking window, as plain paragraphs. */
export function keywordMethodNotes(summary:HomeKeywordSummary|null,basis:RankingBasis):string[]{
 if(!summary)return [`${TAG_SOURCE_ATTRIBUTION}。這個期間的排行摘要目前未提供，狀態未知，不代表沒有相關影片。`];
 const exclusions=summary.exclusions,comparison=summary.comparison;
 const minimum=typeof comparison?.minCoverage==='number'?`${Math.round(comparison.minCoverage*100)}%`:null;
 return [
  `${TAG_SOURCE_ATTRIBUTION}。${vocabularyPoolLabel(summary)}`,
  `範圍：${dateTime(summary.from)} 至 ${dateTime(summary.to)} 發布的已收錄影片；${keywordCoverageLabel(summary)}。${matchCoveragePercent(summary)?`有效比對占 ${matchCoveragePercent(summary)}，這只是比對完成的影片比例，不是內容失真、無用詞或樣板的比例。`:''}尚未收錄或尚未比對的影片不在排行內。`,
  `更新：共同詞彙比對最後更新於 ${summary.updatedAt?dateTime(summary.updatedAt):'未記錄'}。`,
  `比對：以共同詞彙比對影片標題與說明的文字（${ruleVersionLabel(summary.ruleVersion)}），不是 AI 判讀；字幕尚未取得，不列入比對。${summary.ruleVersion==='exact-text-v1'?'此期間仍使用舊版精確文字比對，尚未套用 YouTube 品質過濾。':`${DESCRIPTION_TEMPLATE_NOTE}`}`,
  basis==='heat'
   ?'熱度：標題命中的影片計 3、僅說明命中的影片計 1；同一頻道的影片依序乘以 1、0.5、0.25……遞減（標題命中的影片先計），再加總各頻道。單一頻道大量上片不會無限推高熱度。'
   :'此期間資料服務尚未提供加權熱度，排行依已比對影片數排序；熱度與升溫顯示「資料不足」，不以影片數冒充熱度。',
  `升溫：本期熱度減去前一段等長期間的熱度，只有兩段期間的有效比對都${minimum?`達 ${minimum} 以上`:'完整'}時才計算，否則顯示「${INSUFFICIENT}」，不以 0 代替；未比對或文字已變動的影片不計入。${comparison?`前期 ${dateTime(comparison.from)} 至 ${dateTime(comparison.to)}，有效比對 ${count(comparison.freshVideos)}／${count(comparison.sourceVideos)} 支${matchCoveragePercent(comparison)?`（${matchCoveragePercent(comparison)}）`:''}，${comparison.complete?'兩段期間都達門檻':'未達門檻'}。`:'這個期間沒有前期比較資料。'}走勢為每日熱度，${minimum?`有效比對未達 ${minimum} `:'比對未完成'}的日期留白。`,
  `觀看：影片目前的累計觀看合計，不是期間增量。有已測觀看但仍有影片缺值時，顯示「≥已知小計」和缺值支數，這是合計下界；下界縮寫向下取整，已知小計不是完整合計。全部缺值或沒有可用小計時才顯示「${NO_VIEWS}」，缺值不補 0，也不排在觀看最低。`,
  '示例：代表影片、頻道與命中片段只是說明用的例子，不是隨機抽樣，不能用來推算整體比例或全站失真程度。',
  ...(summary?.rankingPool?.status==='available'?[`新聞詞池：先選取新文易數同一期間、至少兩家媒體各兩篇不同文章的合格詞，再依 YouTube 頻道加權熱度排序；新聞文章數不充當影片數。詞池共 ${count(summary.rankingPool.provenance.eligibleTotal)} 詞，截止 ${dateTime(summary.rankingPool.provenance.window.until)}。快照 ${summary.rankingPool.provenance.snapshotId}。升溫與每日走勢沿用本期合格詞的固定集合，非每天重新挑詞。`]:[]),
  `寫法：僅英文大小寫不同的標籤合併為一列，原始寫法保留在詞彙池。${DISPLAY_EXCLUSION_NOTE}${exclusions?(exclusions.terms>0?`本期另有 ${count(exclusions.terms)} 個命中詞依標籤顯示規則不列入排行（${Object.entries(exclusions.reasons).map(([code,n])=>`${exclusionReasonLabel(code)} ${count(n)} 個`).join('、')}）；排除只影響排行顯示，原始詞彙池與比對證據都保留。規則版本 ${exclusions.youtubePolicyVersion}，上游規則 ${exclusions.policyCommit.slice(0,7)}。`:'本期沒有依標籤顯示規則排除的命中詞。'):'排除規則統計目前未提供。'}`,
 ];
}
/** Bounded one-line snippet anchored on the match: at most `lead` characters of context
 * before it (so a narrow, end-truncated cell still shows the mark) and the rest after it.
 * Offsets come from the source; ones that do not fit the snippet keep the text unmarked. */
export function evidenceParts(evidence:{snippet:string;start:number;end:number;snippetStart:number},max=90,leadMax=8){
 const text=typeof evidence.snippet==='string'?evidence.snippet:'',start=evidence.start-evidence.snippetStart,end=evidence.end-evidence.snippetStart;
 const clip=(value:string)=>value.length>max?value.slice(0,max-1)+'…':value;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>text.length)return {before:clip(text),match:'',after:''};
 const room=Math.max(0,max-(end-start)),lead=Math.min(start,leadMax,Math.ceil(room/2)),from=start-lead,to=Math.min(text.length,end+room-lead);
 return {before:(from>0?'…':'')+text.slice(from,start),match:text.slice(start,end),after:text.slice(end,to)+(to<text.length?'…':'')};
}
export const EVIDENCE_FIELD_LABELS:Record<string,string>={title:'標題',description:'說明',caption:'字幕'};
export type KeywordEvidence={term:string;field:string;snippet:string;start:number;end:number;snippetStart:number};
/** VideoRow.keywordEvidence (at most three per video). null = the API did not send the field;
 * malformed entries are dropped rather than repaired. */
export function keywordEvidenceOf(row:object):KeywordEvidence[]|null{
 const value=(row as {keywordEvidence?:unknown}).keywordEvidence;
 if(!Array.isArray(value))return null;
 return value.filter((e):e is KeywordEvidence=>!!e&&typeof e==='object'&&typeof e.term==='string'&&typeof e.field==='string'&&typeof e.snippet==='string'&&[e.start,e.end,e.snippetStart].every(Number.isInteger)).slice(0,3);
}
