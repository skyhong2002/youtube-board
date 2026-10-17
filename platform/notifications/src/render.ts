import type {Provider,ProviderRequest} from '@youtube-board/ai';
import {type Brief,type Context,type Decision,type Event,type Post,type Video,groups,hash,record,unique,instant,taipeiSql} from './contracts.js';
import {bigrams} from './stories.js';

// ---- PHP string helpers (Laravel parity) -------------------------------------------------------------------
const PHP_TRIM=' \t\n\r\0\x0B';
const trimChars=(s:string,chars:string,left:boolean,right:boolean)=>{const a=[...s];let i=0,j=a.length;while(left&&i<j&&chars.includes(a[i]!))i++;while(right&&j>i&&chars.includes(a[j-1]!))j--;return a.slice(i,j).join('');};
const trim=(s:string)=>trimChars(s,PHP_TRIM,true,true);
const rtrim=(s:string,chars=PHP_TRIM)=>trimChars(s,chars,false,true);
const mbLen=(s:string)=>[...s].length;
const mbSub=(s:string,n:number)=>[...s].slice(0,n).join('');
const str=(v:unknown)=>typeof v==='string'?v:typeof v==='number'&&Number.isFinite(v)?String(v):typeof v==='boolean'?(v?'1':''):'';
/** Collection filter(scalar non-blank)->map(trim)->unique()->take(limit). */
const cleanList=(values:unknown,limit:number)=>unique((Array.isArray(values)?values:[]).filter(v=>['string','number','boolean'].includes(typeof v)&&trim(str(v))!=='').map(v=>trim(str(v)))).slice(0,limit);
/** PHP array_filter() on strings: drops '' and '0'. */
const kept=(v:string)=>v!==''&&v!=='0';
const byteOrder=(a:string,b:string)=>a<b?-1:a>b?1:0;
const GROUP_ORDER=['泛綠','泛藍','泛白','泛紅','較無偏','中立','公共電視','公共媒體','其他'];
const groupIndex=(g:string)=>{const i=GROUP_ORDER.indexOf(g);return i<0?99:i;};

// ---- TelegramVideoRanker ---------------------------------------------------------------------------------
const norm=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
const channelKey=(v:Video)=>v.uId>0?'u:'+v.uId:'c:'+v.channel;
export function recommend(event:Event,limit=3):Video[]{
 let videos=event.videos.filter(v=>v.title&&v.channel&&v.url);const max=Math.max(0,...videos.map(v=>v.views??0));
 const a=bigrams(norm(event.title)),keywords=event.keywords.map(norm).filter(Boolean),score=(v:Video)=>{const b=bigrams(norm(v.title)),dice=a.length&&b.length?2*a.filter(k=>b.includes(k)).length/(a.length+b.length):0,coverage=keywords.length?keywords.filter(k=>norm(v.title).includes(k)).length/keywords.length:0;return .5*dice+.25*Math.min(1,coverage)+.25*(max>0?Math.log1p(v.views??0)/Math.log1p(max):0);};
 const picks:Video[]=[],channels=new Set<string>(),selectedGroups=new Set<string>();
 while(videos.length&&picks.length<Math.min(3,Math.max(0,limit))){const fresh=channels.size? videos.filter(v=>!channels.has(channelKey(v))):[];const pool=fresh.length?fresh:videos;const adjusted=(v:Video)=>score(v)+(channels.size&&!channels.has(channelKey(v))?.05:0)+(channels.size&&groups.includes(v.group)&&!selectedGroups.has(v.group)?.15:0);pool.sort((a,b)=>adjusted(b)-adjusted(a)||(b.views??0)-(a.views??0)||byteOrder(b.publishedAt,a.publishedAt)||a.position-b.position);const picked=pool[0]!;picks.push(picked);channels.add(channelKey(picked));if(groups.includes(picked.group))selectedGroups.add(picked.group);videos=videos.filter(v=>v.videoId!==picked.videoId);}
 return picks;
}

/** Broadcaster::displayGroupVideoCounts: groups of the displayed videos (event order), unresolved IDs as 其他, arsort. */
export function distribution(event:Event,decision:Pick<Decision,'displayVideoIds'>):[string,number][]{
 const clean=(ids:unknown[])=>unique(ids.filter(id=>['string','number'].includes(typeof id)&&trim(str(id))!=='').map(id=>trim(str(id))));
 let ids=clean(decision.displayVideoIds);if(!ids.length)ids=clean(event.videoIds);if(!ids.length)return [];
 const wanted=new Set(ids),counts=new Map<string,number>();
 for(const v of event.videos){if(!wanted.has(v.videoId))continue;const g=trim(v.group)||'其他';counts.set(g,(counts.get(g)??0)+1);}
 const missing=Math.max(0,ids.length-[...counts.values()].reduce((n,c)=>n+c,0));if(missing>0)counts.set('其他',(counts.get('其他')??0)+missing);
 return [...counts].map((e,i)=>({e,i})).sort((a,b)=>b.e[1]-a.e[1]||a.i-b.i).map(({e})=>e);
}

// ---- EventNewsWriter -------------------------------------------------------------------------------------
/** Laravel EventNewsWriter::SYSTEM, verbatim. */
export const NEWS_WRITER_SYSTEM="你是「臺灣 YouTube 新聞觀測站」Telegram 頻道的編輯。輸入是一批當日/當時 YouTube 上最受關注事件的結構化資料。請為每則事件寫繁體中文（台灣新聞用語）的新聞標題與摘要，讓只看標題的人也知道發生了什麼。\n\n嚴格規則：\n1. 只能根據提供的欄位（事件標題、原始描述、分類、角度、陣營、關鍵字、人物、地名、新聞台名稱、新聞台標籤、相關影片標題、影片數、來源頻道數、group_video_counts）撰寫。嚴禁虛構、推測或補充資料中沒有的人名、數字、引述、地點或因果。\n2. 若資訊不足以寫出可靠的摘要，summary 就寫得保守、精簡，寧可少講也不要編造。\n3. 每則固定寫成四個短段落，段落之間用兩個換行分隔，每段 1 至 2 句。第一段交代整體發生的狀況與最新進展；第二段說明影片數最多的有效陣營或來源群組在強調什麼，並具名新聞台；第三段說明影片數第二多的陣營或其他主要來源在強調什麼，也要具名新聞台；第四段綜合各來源的共同焦點與差異。若只有一個有效陣營，不得虛構第二陣營，第三段改寫其他具名來源的次要焦點。\n4. 資料若包含多個具名新聞台，至少指出兩家新聞台各自報導的重點，這兩家名稱須逐字保留輸入的完整 channel 名稱以供核對；不要用「部分頻道」「有媒體」這類模糊說法。不要逐字抄錄完整影片標題，也不要把頻道口號、節目名稱、YouTube handle 或重複品牌字樣塞進摘要，應改寫成與事件直接相關的焦點。\n5. 新聞台的政治或兩岸屬性只能引用輸入的 channel_tags 與 group_video_counts，不得根據印象自行判定。不同新聞台若有泛藍、泛綠、泛白、泛紅、較無偏、公共媒體、台灣立場或中國立場等標籤，應客觀交代其報導角度差異。數量比較以影片數為準，不以頻道數為準。\n6. 不要出現「根據資料」「本則事件」「以下」等後設用語，也不要加開場白。\n7. headline 是給讀者看的新聞標題，12 至 64 字，以「誰＋做了什麼／說了什麼＋具體結果或爭點」寫出最主要的一件事；不能只列人物、地名、關鍵字，或停在「相關議題」「關係解讀」「互動活動」「引發關注」。例如把「市長市場行程與互動活動」寫成「市長到市場掃街，攤商當面要求改善排水」。例句只是格式，不能把例句的事實帶入輸出。沒有結果就只寫有依據的動作，不得補造結果。\n8. headline 與摘要第一段必須以原始影片標題為依據。上游事件名稱與描述可能過度合併或誤連地點，不能當成已核實事實；不要因影片同時提到兩個地名就自行推定行政區歸屬。同一人物的不同活動不可串成同一次行程。若來源是評論、預測、質疑或指控，標題必須具名歸因並保留「稱」「質疑」「恐」等原有不確定性；不可把問句改成確定結論，也不可把熱門影片數當成社會支持度。只有評論可用時，就交代誰對哪件事提出什麼具體說法。\n9. headline_video_ids 必須列出直接支持標題的輸入 videos[].video_id（至少一個），標題的每項具體主張都須有列出的影片支持。不要為寫標題新增輸入以外的事實。不足以寫出可靠標題時 headline 留空，headline_video_ids 用空陣列。\n10. 第一段直接交代具體動作、說法或進展，不要只寫「成為分析焦點」「引發討論」。來源分布與媒體比較放在後三段。\n11. 只輸出 JSON 物件，格式為 {\"items\":[{\"title\": 原事件標題（原封不動，僅供資料對應）, \"headline\": 新聞標題, \"headline_video_ids\": [支持標題的影片ID], \"summary\": 你寫的四段摘要}]}。items 的順序與數量必須對應輸入事件。";
export interface NotificationRequest extends ProviderRequest {system?:string}
interface PayloadVideo {video_id:string;title:string;channel:string;channel_tags:string[];view_count:number|null}
interface PayloadReport {u_id:number;channel:string;event:string;description:string;category:string;angle:string;camp:string;keywords:string[];people:string[];places:string[];video_ids:string[];channel_tags:string[];group:string}
export interface WriterEvent {title:string;description:string;category:string;angle:string;camp:string;keywords:string[];people:string[];places:string[];media:string[];media_reports:PayloadReport[];group_video_counts:Record<string,number>|[];videos:PayloadVideo[];video_count:number;media_count:number}
/** The exact event shape Laravel's broadcaster hands to the writer (videos without group/u_id, first 18). */
export function writerEvent(event:Event,decision:Pick<Decision,'displayVideoIds'>):WriterEvent{
 const counts=distribution(event,decision);
 return {title:event.title,description:event.description,category:event.category,angle:event.angle,camp:event.camp,keywords:event.keywords,people:event.people,places:event.places,media:event.media??[],
  media_reports:event.mediaReports.map(r=>({u_id:r.uId,channel:r.channel,event:r.event,description:r.description,category:r.category,angle:r.angle,camp:r.camp,keywords:r.keywords,people:r.people,places:r.places,video_ids:r.videoIds,channel_tags:r.tags,group:r.group})),
  group_video_counts:counts.length?Object.fromEntries(counts):[],
  videos:event.videos.slice(0,18).map(v=>({video_id:v.videoId,title:v.title,channel:v.channel,channel_tags:v.tags,view_count:v.views})),
  video_count:event.videoCount,media_count:event.mediaCount};
}
/** json_encode(..., JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT): four-space indent, escaped slashes and line separators. */
export function phpPrettyJson(value:unknown){return JSON.stringify(value,null,4).replaceAll('/','\\/').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');}
function focusText(value:string,limit:number){
 let v=trim(value).replace(/\s+/gu,' ');
 v=v.replace(/^(?:【[^】]{1,30}】\s*)+/u,'').replace(/^(?:[#＃][\p{L}\p{N}_-]+\s*)+/u,'').replace(/\s*@[-_.a-z0-9]+\s*$/iu,'');
 v=trim(trim(v.split(/\s*[｜|]\s*/u)[0]??v)).replace(/[。.!！?？]+$/u,'');
 return mbLen(v)>limit?rtrim(mbSub(v,limit),PHP_TRIM+'，、；;：:')+'…':v;
}
const sentence=(value:string)=>{const v=trim(value);return /[。！？!?]$/u.test(v)?v:v+'。';};
const sourceParagraph=(channel:string,detail:string,group:string)=>(trim(group)||'其他')+'來源中，'+channel+'著重'+sentence(focusText(detail,44));
const uniqueBy=<T>(items:T[],key:(v:T)=>string)=>{const seen=new Set<string>();return items.filter(v=>{const k=key(v);if(seen.has(k))return false;seen.add(k);return true;});};
/** EventNewsWriter::fallback — grounded copy naming two sources, or '' (the event is then incomplete). */
export function laravelFallback(event:Partial<WriterEvent>&{title:string}):string{
 const paragraphs:string[]=[],description=trim(str(event.description));
 const keywords=(n:number)=>cleanList(event.keywords,n);
 if(description)paragraphs.push(sentence(focusText(description,180)));
 else{const title=trim(event.title),kw=keywords(4);if(title)paragraphs.push(sentence(title+(kw.length?'，目前報導聚焦'+kw.join('、'):'')));}
 const videos=(event.videos??[]).filter(record) as unknown as Record<string,unknown>[];
 const reports=((event.media_reports??[]) as unknown[]).filter(record).map(r=>{if(trim(str(r.group))!=='')return r;const uId=Math.trunc(Number(r.u_id))||0,channel=trim(str(r.channel??r.媒體));const match=videos.find(v=>uId>0&&(Math.trunc(Number(v.u_id))||0)===uId||channel!==''&&trim(str(v.channel))===channel);return match?{...r,group:trim(str(match.group))}:r;});
 const counts=event.group_video_counts&&!Array.isArray(event.group_video_counts)?Object.entries(event.group_video_counts):[];
 const groupOrder=counts.filter(([,n])=>Math.trunc(Number(n))>0).map((e,i)=>({e,i})).sort((a,b)=>Number(b.e[1])-Number(a.e[1])||a.i-b.i).map(({e})=>e[0]);
 const reportChannel=(r:Record<string,unknown>)=>trim(str(r.channel??r.媒體));
 const orderedReports=uniqueBy([...groupOrder.map(g=>reports.find(r=>str(r.group)===g)).filter(record),...reports],reportChannel);
 const seen=new Set<string>();
 for(const r of orderedReports){const channel=reportChannel(r),detail=trim(str(r.description??r.描述));if(!channel||!detail||seen.has(channel))continue;paragraphs.push(sourceParagraph(channel,detail,str(r.group)));seen.add(channel);if(seen.size>=2)break;}
 if(seen.size<2){
  const orderedVideos=uniqueBy([...groupOrder.map(g=>videos.find(v=>str(v.group)===g)).filter(record),...videos],v=>trim(str(v.channel)));
  for(const v of orderedVideos){const channel=trim(str(v.channel)),title=trim(str(v.title));if(!channel||!title||seen.has(channel))continue;paragraphs.push(sourceParagraph(channel,title,str(v.group)));seen.add(channel);if(seen.size>=2)break;}
 }
 if(!paragraphs.length||seen.size<2)return '';
 const focus=keywords(5);if(focus.length)paragraphs.push('整體報導共同關注'+focus.join('、')+'等進展。');
 return unique(paragraphs).slice(0,4).join('\n\n');
}
/** EventNewsWriter::namesRequiredMedia. */
function namesRequiredMedia(summary:string,event:WriterEvent){
 let channels=unique(event.media_reports.map(r=>trim(r.channel)).filter(Boolean));
 if(channels.length<2)channels=unique([...channels,...event.videos.map(v=>trim(v.channel)).filter(Boolean)]);
 return channels.length<2||channels.filter(c=>summary.includes(c)).length>=2;
}
/** EventNewsWriter::validatedHeadline — shape and source membership only. */
function validatedHeadline(item:Record<string,unknown>,event:WriterEvent):{headline:string;evidence:string[]}|null{
 const raw=item.headline,evidence=item.headline_video_ids;if(typeof raw!=='string'||!Array.isArray(evidence)||!evidence.length)return null;
 const headline=trim(raw);if(mbLen(headline)<12||mbLen(headline)>64||/[\r\n<>]/u.test(headline))return null;
 const known=event.videos.filter(v=>typeof v.title==='string'&&trim(v.title)!=='').map(v=>v.video_id).filter(id=>typeof id==='string'&&id!=='');
 return evidence.every(id=>typeof id==='string'&&known.includes(id))?{headline,evidence:evidence as string[]}:null;
}
/** EventNewsWriter::parse — items keyed by trimmed original title; later duplicates win. */
function parseItems(content:string){
 let t=trim(content);if(t.startsWith('```'))t=trim(t.replace(/^```(?:json)?\s*|\s*```$/gi,''));
 let decoded:unknown;try{decoded=JSON.parse(t);}catch{return new Map<string,Record<string,unknown>>();}
 const items=record(decoded)?decoded.items:undefined,map=new Map<string,Record<string,unknown>>();
 for(const item of Array.isArray(items)?items:record(items)?Object.values(items):[]){if(!record(item))continue;const title=typeof item.title==='string'?trim(item.title):'',summary=typeof item.summary==='string'?trim(item.summary):'';if(title&&summary)map.set(title,{...item,summary});}
 return map;
}
const PROMPT_BYTES_CAP=2_000_000;
/** EventNewsWriter::briefs. Original titles stay identity keys; a missing summary makes the post incomplete. */
export async function writeBriefs(events:{event:Event;decision:Pick<Decision,'displayVideoIds'>}[]|Event[],provider?:Provider):Promise<Brief[]> {
 const items=(events as unknown[]).map(e=>record(e)&&'event' in e?e as {event:Event;decision:Pick<Decision,'displayVideoIds'>}:{event:e as Event,decision:{displayVideoIds:[]}});
 const payload=items.map(({event,decision})=>writerEvent(event,decision));
 const briefs:Brief[]=payload.map(e=>({headline:e.title,summary:laravelFallback(e),evidence:[],kind:'extractive',model:null,requestedModel:null,promptHash:null,usage:null,aiOutcome:'not-requested'}));
 if(!provider||!items.length)return briefs;
 const prompt=phpPrettyJson({events:payload});
 if(Buffer.byteLength(prompt)>PROMPT_BYTES_CAP)return briefs.map(b=>({...b,promptHash:hash(prompt),aiOutcome:'prompt-cap'}));
 let attempted:Brief[]=briefs.map(b=>({...b,promptHash:hash(prompt),aiOutcome:'failed'}));
 let response;try{response=await provider.complete({input:{kind:'notification'},prompt,schema:{},system:NEWS_WRITER_SYSTEM} as NotificationRequest);}catch{return attempted;}
 attempted=attempted.map(b=>({...b,model:response.model,requestedModel:response.requestedModel,usage:response.usage,aiOutcome:'rejected'}));
 const generated=parseItems(response.content);
 return payload.map((event,index)=>{
  const brief=attempted[index]!,item=generated.get(event.title)??{},summary=typeof item.summary==='string'?item.summary:null;
  const summaryOk=summary!==null&&namesRequiredMedia(summary,event),body=summaryOk?summary!:brief.summary;
  // Source-name checks on the body must not discard an independently valid headline when a body exists.
  const head=body?validatedHeadline(item,event):null;
  const accepted=summaryOk||!!head;
  return {...brief,headline:head?.headline??event.title,summary:body,evidence:head?.evidence??[],kind:accepted?'generated':'extractive',aiOutcome:accepted?'accepted':'rejected'};
 });
}
/** Kept for callers that only need the source-attributed copy. */
export function fallbackBrief(event:Event):Brief{return {headline:event.title,summary:laravelFallback(writerEvent(event,{displayVideoIds:[]})),evidence:[],kind:'extractive',model:null,requestedModel:null,promptHash:null,usage:null,aiOutcome:'not-requested'};}

// ---- TelegramDigestFormatter ---------------------------------------------------------------------------------
export const MAX_LENGTH=4096;
const e=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
/** htmlspecialchars(ENT_QUOTES|ENT_SUBSTITUTE|ENT_HTML5). */
const attr=(s:string)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&apos;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const ENTITIES:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#039':"'",'#39':"'"};
/** html_entity_decode(strip_tags(br→\n)) measured in UTF-16 code units, like Laravel and Telegram. */
export function visibleLength(html:string){return html.replaceAll('<br>','\n').replaceAll('<br/>','\n').replaceAll('<br />','\n').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|apos|#039|#39);/g,(_,k:string)=>ENTITIES[k]!).length;}
const safeUrl=(s:string)=>{const u=new URL(s);if(u.protocol!=='https:'||u.username||u.password)throw new Error('notification_url_invalid');return s;};
export interface FormatterVideo {video_id?:string;title:string;channel:string;tags:string[];group:string;url:string}
export interface FormatterPost {title:string;summary:string;description:string;category:string;angle:string;camp:string;keywords:string[];people:string[];places:string[];video_count:number;media_count:number;group_video_counts:[string,number][]|Record<string,number>;videos:FormatterVideo[];recommendations:FormatterVideo[];metric_line?:string;burst_line?:string;previous_posted_at?:string|null;url:string;label:string}
const normalizedText=(v:string)=>v.replace(/[^\p{L}\p{N}]+/gu,'').toLowerCase();
export function shortVideoTitle(raw:string,channel:string){
 let title=trim(raw).replace(/\s+/gu,' ');
 title=title.replace(/^(?:【[^】]{1,30}】\s*)+/u,'').replace(/^(?:直播(?:完整版)?|快新聞)[／\/:：]\s*/u,'').replace(/\s*@[-_.a-z0-9]+\s*$/iu,'').replace(/(?:\s+[#＃][\p{L}\p{N}_-]+)+\s*$/u,'').replace(/\s*【[^】]{1,30}】\s*$/u,'').replace(/\s+\p{Nd}{8}\s*$/u,'');
 title=trim(title.split(/\s*[｜|│]\s*/u)[0]??title);
 const m=/^(.*?)[－–—]\s*([^－–—]+)$/u.exec(title);
 if(m){const suffix=normalizedText(trim(m[2]!)),own=normalizedText(channel);if(suffix!==''&&(own.includes(suffix)||suffix.includes(own)))title=trim(m[1]!);}
 if(mbLen(title)>56)title=rtrim(mbSub(title,56)).replace(/[，、；;：:]+$/u,'')+'…';
 return title!==''?title:'查看影片';
}
function videoLine(v:FormatterVideo){
 const channel=trim(v.channel)||'未知頻道',tags=cleanList(v.tags,3),display=channel.replace(/\s+Formosa\s+TV\s+News\s+network$/iu,'');
 return '<b>'+e(display+(tags.length?'〔'+tags.join('、')+'〕':''))+'</b>　<a href="'+attr(safeUrl(v.url))+'">'+e(shortVideoTitle(v.title,channel))+'</a>';
}
const videoKey=(v:FormatterVideo)=>{const id=trim(v.video_id??'');return id?'id:'+id:'url:'+trim(v.url);};
function coverageBlocks(all:FormatterVideo[],recommendations:FormatterVideo[]){
 const videos=all.filter(v=>trim(v.title)!==''&&trim(v.url)!==''),picks:number[]=[];
 for(const r of recommendations){const key=videoKey(r);const index=videos.findIndex((v,i)=>!picks.includes(i)&&videoKey(v)===key);if(index>=0)picks.push(index);if(picks.length>=3)break;}
 if(!picks.length&&!recommendations.length){const picked=new Set<string>();videos.forEach((v,i)=>{if(picks.length>=3)return;const g=trim(v.group)||'其他';if(!picked.has(g)){picks.push(i);picked.add(g);}});}
 const blocks:{html:string;video:boolean}[]=[];
 if(picks.length){blocks.push({html:'<b>先看</b>',video:false});for(const i of picks)blocks.push({html:videoLine(videos[i]!),video:true});}
 const byGroup=new Map<string,FormatterVideo[]>();videos.forEach((v,i)=>{if(picks.includes(i))return;const g=trim(v.group)||'其他';byGroup.set(g,[...(byGroup.get(g)??[]),v]);});
 for(const[g,items]of[...byGroup].sort((a,b)=>groupIndex(a[0])-groupIndex(b[0])||byteOrder(a[0],b[0]))){blocks.push({html:'<b>'+e(g)+'</b>',video:false});for(const v of items)blocks.push({html:videoLine(v),video:true});}
 return blocks;
}
function sortedGroupCounts(counts:FormatterPost['group_video_counts']){
 const entries=(Array.isArray(counts)?counts:Object.entries(counts)).map(([g,n])=>[trim(String(g)),Math.trunc(Number(n))] as [string,number]).filter(([g,n])=>g!==''&&n>0);
 const merged=new Map<string,number>();for(const[g,n]of entries)merged.set(g,n);
 return [...merged].sort((a,b)=>b[1]-a[1]||groupIndex(a[0])-groupIndex(b[0])||byteOrder(a[0],b[0]));
}
function metaBlocks(p:FormatterPost){
 const blocks:string[]=[],context=([['分類',p.category],['角度',p.angle],['陣營',p.camp]] as const).map(([k,v])=>[k,trim(v??'')]).filter(([,v])=>v!=='').map(([k,v])=>k+v);
 if(context.length)blocks.push(e(context.join('｜')));
 const counts=sortedGroupCounts(p.group_video_counts).slice(0,6).map(([g,n])=>g+Math.max(0,n)+'支');if(counts.length)blocks.push('▸ 影片分布　'+e(counts.join('、')));
 const keywords=cleanList(p.keywords,8);if(keywords.length)blocks.push('# '+e(keywords.join('、')));
 const people=cleanList(p.people,6),places=cleanList(p.places,6),entities=[...(people.length?['人物　'+people.join('、')]:[]),...(places.length?['地名　'+places.join('、')]:[])];if(entities.length)blocks.push(e(entities.join('｜')));
 const burst=trim(p.burst_line??'');if(burst)blocks.unshift('↗ '+e(burst));
 return blocks;
}
function previousUpdateLabel(value:unknown){
 if(typeof value!=='string'||trim(value)==='')return '';
 const at=/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)?instant(value):new Date(value);if(!Number.isFinite(at.getTime()))return '';
 return taipeiSql(at).slice(5,16).replace('-','/');
}
function assemble(header:string,meta:string[],expanded:string,footer:string){
 const preamble=[header,...meta].filter(b=>b!=='').join('\n');
 return [preamble,expanded!==''?'<blockquote expandable>'+expanded+'</blockquote>':'',footer].filter(b=>b!=='').join('\n\n');
}
function expandedWithinBudget(header:string,meta:string[],summary:string,coverage:{html:string;video:boolean}[],footer:string){
 const videoCount=coverage.filter(r=>r.video).length,required=Math.min(2,videoCount);let included:string[]=[],includedVideos=0,optionalOffset=coverage.length;
 for(const[index,row]of coverage.entries()){included.push(row.html);includedVideos+=Number(row.video);if(includedVideos>=required){optionalOffset=index+1;break;}}
 const expanded=(summaryHtml:string,rows:string[],videos:number)=>{const remaining=Math.max(0,videoCount-videos);return [summaryHtml,rows.length?rows.join('\n'):'',remaining>0?'其餘'+remaining+'支見完整整理':''].filter(kept).join('\n\n');};
 const build=(s:string,rows:string[],videos:number)=>assemble(header,meta,expanded(s,rows,videos),footer);
 let summaryHtml=summary!==''?e(summary):'';
 if(visibleLength(build(summaryHtml,included,includedVideos))>MAX_LENGTH){
  const length=mbLen(summary);let low=0,high=length,best='';
  while(low<=high){const middle=Math.floor((low+high)/2),trimmed=rtrim(mbSub(summary,middle)),candidate=trimmed!==''?e(trimmed)+(middle<length?'…':''):'';if(visibleLength(build(candidate,included,includedVideos))<=MAX_LENGTH){best=candidate;low=middle+1;}else high=middle-1;}
  summaryHtml=best;
 }
 for(const row of coverage.slice(optionalOffset)){const candidate=[...included,row.html],videos=includedVideos+Number(row.video);if(visibleLength(build(summaryHtml,candidate,videos))>MAX_LENGTH)break;included=candidate;if(row.video)includedVideos++;}
 return expanded(summaryHtml,included,includedVideos);
}
function truncateVisibleMessage(header:string,metaIn:string[],summary:string,coverage:{html:string;video:boolean}[],footer:string){
 const meta=[...metaIn],videoCount=coverage.filter(r=>r.video).length,priority:string[]=[];let priorityVideos=0;
 for(const row of coverage){priority.push(row.html);if(row.video)priorityVideos++;if(priorityVideos>=Math.min(2,videoCount))break;}
 const remaining=Math.max(0,videoCount-priorityVideos);
 const build=(trimmed:string,wasTrimmed:boolean)=>assemble(header,meta,[trimmed!==''?e(trimmed)+(wasTrimmed?'…':''):'',priority.length?priority.join('\n'):'',remaining>0?'其餘'+remaining+'支見完整整理':''].filter(kept).join('\n\n'),footer);
 while(meta.length&&visibleLength(build('',summary!==''))>MAX_LENGTH)meta.pop();
 const full=build(summary,false);if(visibleLength(full)<=MAX_LENGTH)return full;
 const length=mbLen(summary);let low=0,high=length,best='';
 while(low<=high){const middle=Math.floor((low+high)/2),candidate=build(rtrim(mbSub(summary,middle)),middle<length);if(visibleLength(candidate)<=MAX_LENGTH){best=candidate;low=middle+1;}else high=middle-1;}
 return best!==''?best:build('',summary!=='');
}
/** TelegramDigestFormatter::format, verbatim semantics. */
export function formatLaravelPost(p:FormatterPost):string{
 const title=trim(p.title??'')||'未命名事件',url=trim(p.url??'');
 const header=url!==''?'<a href="'+attr(safeUrl(url))+'"><b>'+e(title)+'</b></a>':'<b>'+e(title)+'</b>';
 let metric=trim(p.metric_line??'');
 if(metric===''){const counts:string[]=[];if(Math.trunc(p.video_count)>0)counts.push('影片'+Math.trunc(p.video_count));if(Math.trunc(p.media_count)>0)counts.push('來源頻道'+Math.trunc(p.media_count));metric=counts.join('｜');}
 const meta=metaBlocks(p);
 if(metric!==''){const previous=previousUpdateLabel(p.previous_posted_at);if(previous!==''&&metric.includes('上次推播後'))metric=metric.replaceAll('上次推播後','上次推播後（前次 '+previous+'）');meta.unshift('⏱ '+e(metric));}
 const label=trim(p.label??''),link=url!==''?'↗ <a href="'+attr(url)+'">完整整理</a>':'',footer=link!==''&&label!==''?link+' · '+e(label):link!==''?link:e(label);
 let summary=trim(p.summary??'');if(summary==='')summary=trim(p.description??'');
 const coverage=coverageBlocks(p.videos,p.recommendations),message=assemble(header,meta,expandedWithinBudget(header,meta,summary,coverage,footer),footer);
 return visibleLength(message)<=MAX_LENGTH?message:truncateVisibleMessage(header,meta,summary,coverage,footer);
}
const formatterVideo=(v:Video):FormatterVideo=>({video_id:v.videoId,title:v.title,channel:v.channel,tags:v.tags,group:v.group,url:v.url});
export function formatPost(event:Event,context:Context,decision:Decision,brief:Brief,recommendations:Video[]):string {
 return formatLaravelPost({title:brief.headline,summary:brief.summary,description:event.description,category:event.category,angle:event.angle,camp:event.camp,keywords:event.keywords,people:event.people,places:event.places,video_count:event.videoCount,media_count:event.mediaCount,group_video_counts:distribution(event,decision),videos:event.videos.map(formatterVideo),recommendations:recommendations.map(formatterVideo),metric_line:decision.metricLine,burst_line:decision.burstLine,previous_posted_at:decision.previousPostedAt,url:context.url,label:context.label});
}
/** Broadcaster::complete. */
function complete(context:Context,event:Event,summary:string,picks:Video[]){
 const channels=new Set(event.videos.filter(v=>trim(v.channel)!=='').map(v=>v.uId>0?'u:'+v.uId:'c:'+trim(v.channel))),reports=new Set(event.mediaReports.filter(r=>trim(r.channel)!=='').map(r=>r.uId>0?'u:'+r.uId:'c:'+trim(r.channel)));
 const preview=trim(picks[0]?.url??'');
 return event.videos.length>=3&&channels.size>=2&&picks.length>=2&&summary!==''&&preview.startsWith('https://www.youtube.com/watch?v=')&&(context.period!=='daily'||reports.size>=2);
}
export async function renderPosts(events:{event:Event;decision:Decision}[],context:Context,provider?:Provider):Promise<Post[]> {
 const briefs=await writeBriefs(events,provider);
 return events.map(({event,decision},index)=>{const picks=recommend(event),brief=briefs[index]!,summary=trim(brief.summary);return {event,decision,brief,html:formatPost(event,context,decision,brief,picks),previewUrl:trim(picks[0]?.url??'')||null,complete:complete(context,event,summary,picks)};});
}
