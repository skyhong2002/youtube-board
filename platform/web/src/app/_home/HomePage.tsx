import Link from 'next/link';
import {api,type HomeData,type TopicRow} from '@/lib/api';
import {compact,count} from '@/lib/format';
import {safeReportHref} from '@/lib/report-contract';
import {DataNotice,Unavailable} from '@/components/ReportUI';
import Masthead,{mastheadCanvases} from './Masthead';
import HomeMethods from './HomeMethods';
import {MASTHEAD_WORDS,mastheadEdition} from '@/lib/masthead-cloud';
import {HOME_KEYWORD_RANKING,KEYWORD_WINDOWS,homeKeywordCloudWords,homeKeywordState,homeKeywordSummary,keywordRangeLabel,keywordUpdatedLabel,keywordVideosHref,type KeywordWindow} from '@/lib/home-presentation';
import {TAG_SOURCE_ATTRIBUTION,heatLabel,keywordMethodNotes,rankingBasis,riseLabel,trendLabel,trendValues} from '@/lib/keyword-ranking';
import {VideoThumbnail} from '@/components/VideoThumbnail';
import Sparkline from '@/components/Sparkline';
import VideoPicture from './VideoPicture';
import {ChannelAvatar} from '@/components/ChannelAvatar';
import WordCloud from './WordCloud';
import {KeywordWindowPane,KeywordWindowProvider,KeywordWindowSwitch} from './KeywordWindow';
import styles from './home.module.css';
const Arrow=()=> <span aria-hidden="true">→</span>;
function Section({title,href,label='查看全部',later=false}:{title:string;href?:string;label?:string;later?:boolean}){return <div className={`${styles.sectionHeading} ${later?styles.sectionHeadingLater:''}`}><h2>{title}</h2>{href&&<Link href={href}>{label} <Arrow/></Link>}</div>;}
type KeywordView={window:KeywordWindow;label:string;fixture:boolean}&ReturnType<typeof keywordView>;
function keywordView(exploration:HomeData['exploration'],window:KeywordWindow){const summary=homeKeywordSummary(exploration,window),state=homeKeywordState(summary,window);return {summary,...state,basis:rankingBasis(summary,state.rows)};}
/** Same rows, order and metrics as /keywords; thumbnails are the API's representative video (lazy, fixed 48×27). */
function KeywordRanking({view}:{view:KeywordView}){
 const heat=view.basis==='heat';
 return <>{view.rows.length?<ol className={styles.ranking}>{view.rows.slice(0,HOME_KEYWORD_RANKING).map((term,index)=>{const rise=heat?riseLabel(term,view.summary):null,values=heat?trendValues(term.trend):[];return <li key={term.key}><Link href={keywordVideosHref(term.term,view.summary)}><span className={styles.rank}>{String(index+1).padStart(2,'0')}</span><VideoThumbnail videoId={view.fixture?null:term.representativeVideoId??null} width={48} height={27}/><span className={styles.rankBody}><strong>{term.term}</strong><small>{count(term.videoCount)} 支影片{typeof term.channelCount==='number'&&` · ${count(term.channelCount)} 個頻道`}</small></span><span className={styles.rankTrend}><span className={styles.burst}>{heat?<>熱度 {heatLabel(term)}</>:<>{count(term.videoCount)}<small> 支</small></>}{rise&&<span className={rise.tone==='up'?styles.rankUp:styles.rankSame}>{rise.text}</span>}</span>{values.some(v=>v!==null)&&<span className="text-brand-700 dark:text-brand-400" role="img" aria-label={trendLabel(term.trend)}><Sparkline values={values} className="h-4 w-12"/></span>}</span></Link></li>;})}</ol>:<p className={styles.notice} role="status">{view.message}</p>}
 <p className={styles.panelNote}>{view.summary?<>{keywordRangeLabel(view.summary,view.window)} · {keywordUpdatedLabel(view.summary)}。{heat?'依頻道加權熱度排序；升溫為與前一段等長期間的熱度差，涵蓋不完整時顯示「資料不足」。':'這個期間尚無加權熱度，依已比對影片數排序。'}{TAG_SOURCE_ATTRIBUTION}。</>:`${view.label}範圍與比對狀態未知。`}<a href="#home-method">怎麼算 ⓘ</a></p></>;
}/** Packed around the masthead; an empty window leaves the mark on its own and the caption explains why. */
function KeywordCloud({view}:{view:KeywordView}){
 const words=view.summary?homeKeywordCloudWords(view.rows,view.summary,view.window):[];
 return words.length?<WordCloud words={words} canvases={mastheadCanvases} label={`YouTube ${view.label}關鍵字文字雲`} title={`${view.label}已比對影片的關鍵字`}/>:null;
}
function KeywordCloudNote({view}:{view:KeywordView}){
 return view.rows.length&&view.summary?<p className={styles.panelNote}>字級依{view.label}{view.basis==='heat'?'熱度':'已比對影片數'}（最多 {MASTHEAD_WORDS} 個詞，放不下的小詞省略）· {keywordRangeLabel(view.summary,view.window)} · {keywordUpdatedLabel(view.summary)} · {TAG_SOURCE_ATTRIBUTION}</p>:<p className={styles.panelNote} role="status">{view.message}</p>;
}
/** Same notes as /keywords 「本頁資料來源與計算方式」. */
function KeywordMethod({view}:{view:KeywordView}){
 return <>{view.summary&&view.summary.status!=='synchronized'&&<p>{view.label}熱門標籤：{view.message}</p>}{keywordMethodNotes(view.summary,view.basis).map((note,i)=><p key={i}>{i===0?`${view.label}熱門標籤：`:''}{note}</p>)}<p>沒有比對資料不代表沒有相關影片。<Link href="/keywords">完整熱門標籤排行</Link>．<Link href="/vocabulary">原始詞彙池</Link></p></>;
}
const topicHref=(topic:TopicRow)=>safeReportHref(topic.detailUrl)??`/ai/days/${topic.dailyId}/events?event=${encodeURIComponent(topic.title)}`;
function topicVideoId(topic:TopicRow,data:HomeData){const resolved=topic.evidence.flatMap(e=>e.resolvedVideoIds??[]).find(id=>/^[\w-]{11}$/.test(id));if(resolved)return resolved;const ids=new Set(topic.evidence.flatMap(e=>e.videoIds));return data.live.find(v=>ids.has(v.id))?.id??null;}
function TopicMeta({topic,date}:{topic:TopicRow;date:string|null}){return <p className={styles.source}><span>{date??'日期未記錄'}</span><span>· {topic.grouping?'來源訊號分組':'AI 輔助整理'}</span><span>· {count(topic.channelCount)} 個頻道</span></p>;}
function TopicReferences({topic}:{topic:TopicRow}){return <div className={styles.compactDistribution}><span>{count(topic.videoCount)} {topic.grouping?'支引用影片（去重）':'筆影片引用'}</span>{topic.unresolvedReferences.length>0&&<span>· 另有待確認的來源引用</span>}</div>;}
/** Shared by the ISR entry (/render-isr/home/current, failures throw) and the dynamic fallback at /. */
export default async function HomePage(){
 const result=await api<HomeData>('home');if(!result.ok)return <Unavailable status={result.status} title="有影儀表板"/>;
 const {data,meta}=result.response,discovery=data.exploration,lead=data.events[0],rest=data.events.slice(1,5),edition=mastheadEdition(meta.updatedAt,data.aiDate),keywordViews:KeywordView[]=KEYWORD_WINDOWS.map(({value,label})=>({window:value,label,fixture:meta.dataset==='fixture',...keywordView(discovery,value)})),categories=discovery.categories.status==='available'?discovery.categories.rows:[],otherCategories=categories.slice(3),maxCategoryViews=Math.max(1,...categories.map(r=>r.weeklyViews)),leadChannels=lead?[...new Map(lead.evidence.filter(e=>Number.isSafeInteger(e.channelId)&&e.channelId>0).map(e=>[e.channelId,e])).values()].slice(0,3):[];
 return <div className={styles.home}><div className={styles.main}>
  <KeywordWindowProvider>
  <Masthead edition={edition} cloud={<div id="home-keyword-cloud">{keywordViews.map(view=><KeywordWindowPane key={view.window} window={view.window}><KeywordCloud view={view}/></KeywordWindowPane>)}</div>} caption={<section className={styles.cloudCaption} aria-labelledby="home-cloud-heading"><h2 id="home-cloud-heading">關鍵字文字雲</h2><KeywordWindowSwitch name="home-keyword-window-cloud" className=""/>{keywordViews.map(view=><KeywordWindowPane key={view.window} window={view.window}><KeywordCloudNote view={view}/></KeywordWindowPane>)}</section>}/>
  <DataNotice meta={meta}/>
  <div className={styles.columns}>
   <aside className={styles.left} aria-label="關鍵字排行與頻道動態">
    <Section title="熱門標籤" href="/keywords" label="完整排行"/>
    <KeywordWindowSwitch name="home-keyword-window-ranking"/>
    <div id="home-keyword-ranking">{keywordViews.map(view=><KeywordWindowPane key={view.window} window={view.window}><KeywordRanking view={view}/></KeywordWindowPane>)}</div>
    <Section title="頻道動態" href="/channels" label="全部頻道" later/>
    <ol className={styles.journalists}>{data.channels.slice(0,6).map(channel=><li key={channel.id}><Link href={`/channels/${encodeURIComponent(channel.id)}`}><span className={styles.journalistName}><ChannelAvatar avatar={channel.avatar} title={channel.title} size={18}/><span title={channel.title}>{channel.title}</span></span><span className={styles.journalistOutlets} title={channel.tags.slice(0,2).map(t=>t.name).join(' · ')||'觀測頻道'}>{channel.tags.slice(0,2).map(t=>t.name).join(' · ')||'觀測頻道'}</span><span className={styles.journalistCount}>{compact(channel.weeklyViews)}<small>近七日觀看增量</small></span></Link></li>)}</ol>
    {!data.channels.length&&<p className={styles.notice}>尚無可顯示的頻道觀測。</p>}
    <Section title="自己的觀測清單" href="/boards" label="我的看板" later/>
    <div className={styles.brief}><p className={styles.panelNote}>把關鍵字與頻道篩選存成看板，持續追蹤同一組來源。</p><Link className={styles.textLink} href="/boards">建立觀測看板 <Arrow/></Link></div>
   </aside>
   <section className={styles.center} aria-label="焦點議題">
    <Section title="焦點議題" href="/ai/days" label="每日議題"/>
    {lead?<><article className={styles.hero}><Link href={topicHref(lead)} className={styles.heroImage} tabIndex={-1} aria-hidden="true"><VideoPicture videoId={meta.dataset==='fixture'?null:topicVideoId(lead,data)} variant="hero" priority/></Link><div className={styles.heroContent}><span className={styles.heroBadge}>焦點 01 {lead.keywords.length>0&&<span>／ {lead.keywords.slice(0,2).join(' · ')}</span>}</span><h3><Link href={topicHref(lead)} className={styles.heroLink}>{lead.title}</Link></h3><TopicMeta topic={lead} date={data.aiDate}/><TopicReferences topic={lead}/><div className={styles.heroCamp}>{leadChannels.map(e=><Link key={e.channelId} href={`/channels/${encodeURIComponent(e.channelId)}`}><ChannelAvatar avatar={e.channelAvatar} title={e.channelTitle} size={16}/>{" "}{e.channelTitle}</Link>)}</div><div className={styles.heroFoot}><span>從已保存的分析回到來源影片</span><Link href={topicHref(lead)}>查看議題與來源 <Arrow/></Link></div></div></article><div className={styles.legend}><span>{lead.grouping?'來源訊號分組，請核對原始引用':'引用數不等於不重複影片數'}</span><a href="#home-method">怎麼算 ⓘ</a></div><div className={styles.storyList}>{rest.map((topic,i)=><article className={styles.story} key={topic.id}><div className={styles.storyBody}><p className={styles.storyTags}><span className={styles.storyIndex}>{String(i+2).padStart(2,'0')}</span>{topic.keywords.slice(0,3).join(' / ')}</p><h3><Link href={topicHref(topic)}>{topic.title}</Link></h3><TopicMeta topic={topic} date={data.aiDate}/><TopicReferences topic={topic}/></div><Link href={topicHref(topic)} className={styles.thumbnail} tabIndex={-1} aria-hidden="true"><VideoPicture videoId={meta.dataset==='fixture'?null:topicVideoId(topic,data)} variant="story"/></Link></article>)}<Link href="/ai/days" className={styles.more}>探索更多議題 <Arrow/></Link></div></>:<div className={styles.empty}><span aria-hidden="true">◎</span><h2>尚無已整理的焦點議題</h2><p>議題分析需要可用的來源影片；尚未產出不代表沒有公共討論。</p><Link href="/ai/days">前往每日議題 <Arrow/></Link></div>}
   </section>
   <aside className={styles.right} aria-label="即時直播與頻道分類">
    <Section title="即時直播" href="/live/current" label="全部直播"/>
    <div className={styles.gapList}>{data.live.slice(0,4).map(live=><article className={styles.gapGroup} key={live.id}><p className={styles.gapGroupTitle}><ChannelAvatar avatar={live.channelAvatar} title={live.channelTitle} size={18}/>{" "}{live.channelTitle}</p><ol><li><Link href={`/videos/${encodeURIComponent(live.id)}`}>{live.title}</Link><p><span>目前在線 {count(live.currentViewers)} 人</span><span>今日實測峰值 {count(live.todayPeak)} 人</span>{live.partialLogEvidence&&<span>部分取樣</span>}</p></li></ol></article>)}</div>
    {!data.live.length&&<p className={styles.notice}>目前沒有符合最近有效觀測條件的直播。</p>}
    <Section title="從分類看頻道" href="/tags" label="全部分類" later/>
    <div className={styles.headlineList}>{categories.slice(0,3).map(tag=><article className={styles.headlineCard} key={tag.id}><h3><Link href={`/tags/${tag.id}/channels`}>{tag.name}</Link></h3><div className={styles.headlineSource}><p className={styles.headlineByline}>{count(tag.channels)} 個頻道</p><p className={styles.comparedTitle}>近七日增加 {compact(tag.weeklyViews)} 次觀看</p></div><div className={styles.headlineMore}><Link href={`/tags/${tag.id}/videos`}>影片 <Arrow/></Link><Link href={`/tags/${tag.id}/trends`}>分類趨勢 <Arrow/></Link></div></article>)}</div>
    {!categories.length&&<p className={styles.notice}>{discovery.categories.status==='unavailable'?'分類統計目前無法完整讀取。':'尚無符合觀看增量門檻的分類。'}</p>}
   </aside>
  </div>
  <div className={styles.band}>
   <section className={styles.panel} aria-label="頻道分類觀測摘要"><Section title="頻道分類觀測" href="/tags" label="比較分類"/><div className={styles.graphBody}>{[otherCategories.slice(0,4),otherCategories.slice(4,8)].map((rows,i)=><div key={i}><p className={styles.panelCaption}>{i?'其他已觀測分類':'近七日觀看增量'}</p><ol className={styles.pairList}>{rows.map(tag=><li key={tag.id}><span className={styles.shareRow}><span className={styles.pairNames}><Link href={`/tags/${tag.id}/channels`}>{tag.name}</Link><small>{count(tag.channels)} 個頻道</small></span><span className={styles.shareTrack} aria-hidden="true"><span style={{width:`${Math.max(0,Math.min(100,tag.weeklyViews/maxCategoryViews*100))}%`}}/></span></span><span className={styles.pairCount}>{compact(tag.weeklyViews)} 次</span></li>)}{!rows.length&&<li className={styles.muted}>尚無分類紀錄。</li>}</ol></div>)}<p className={styles.panelFoot}>僅計近七日增量至少 10 次的頻道；跨分類可重複計入，不是全站觀看總量。</p></div></section>
   <section className={styles.panel} aria-label="正在觀測的直播影片"><Section title="直播來源影片" href="/live/periods" label="期間排行"/><ul className={styles.topicList}>{data.live.slice(4,8).map(video=><li key={video.id}><Link href={`/videos/${encodeURIComponent(video.id)}`} className={styles.topicCover} tabIndex={-1} aria-hidden="true"><VideoPicture videoId={meta.dataset==='fixture'?null:video.id} variant="live"/></Link><div className={styles.topicBody}><h3><Link href={`/videos/${encodeURIComponent(video.id)}`}>{video.title}</Link></h3><p><Link href={`/channels/${encodeURIComponent(video.channelId)}`}><ChannelAvatar avatar={video.channelAvatar} title={video.channelTitle} size={16}/>{" "}{video.channelTitle}</Link><span>· {count(video.currentViewers)} 人在線</span></p></div></li>)}{data.live.length<=4&&<li className={styles.muted}>其餘直播來源尚無符合條件的觀測。</li>}</ul></section>
  </div>
  <section className={styles.campShare} aria-label="觀測資料範圍"><p className={styles.campShareLabel}>觀測範圍</p><div className={styles.summaryValues}><span><strong>{count(data.summary.channels)}</strong> 個頻道</span><span><strong>{compact(data.summary.videos)}</strong> 支收錄影片</span><span><strong>{count(data.summary.liveChannels)}</strong> 個頻道直播中</span><span><strong>{compact(data.summary.liveViewers)}</strong> 人在線加總（未去重）</span></div><div className={styles.campShareLinks}><Link href="/groups">頻道群組</Link><Link href="/mayor">地方觀測</Link></div></section>
  <HomeMethods><p>影片、頻道與直播來自 YouTube 觀測。<a href="https://tag.observe.tw">{TAG_SOURCE_ATTRIBUTION}</a>，與 YouTube 頻道分類分開。</p>{keywordViews.map(view=><KeywordWindowPane key={view.window} window={view.window}><KeywordMethod view={view}/></KeywordWindowPane>)}<p>AI 整理與來源訊號分組是探索線索，請開啟議題頁核對引用。直播目前在線、每日取樣峰值、累計觀看與近七日增量是不同度量，不應混用。未記錄的數值顯示為「—」。</p><div className={styles.sourceLinks}><Link href="/about">完整資料說明</Link><Link href="/feeds/videos.xml">影片 RSS</Link><Link href="/events">事件時間軸</Link></div></HomeMethods>
  </KeywordWindowProvider>
 </div></div>;
}
