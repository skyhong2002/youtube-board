import {describe,it,expect} from 'vitest';
import {config,groups,type Context,type Event,type Video} from '../src/contracts.js';
import {normalizeEvent,hydrateDaily,topicStats,usableTopicCache} from '../src/source.js';
import {decide,fingerprint} from '../src/stories.js';
import {NEWS_WRITER_SYSTEM,formatLaravelPost,formatPost,laravelFallback,phpPrettyJson,recommend,renderPosts,shortVideoTitle,visibleLength,writeBriefs,type FormatterPost} from '../src/render.js';
import {NotificationProvider} from '../src/clients.js';

// Golden expectations ported from the Laravel PHPUnit suite (tests/Unit/TelegramDigestFormatterTest.php,
// tests/Feature/Notifications/{TelegramDigestBroadcasterTest,NotificationClientsTest}.php). Laravel used short
// fixture IDs such as v1; TS requires real 11-character YouTube IDs, so vid(n) stands in for v{n}.
const cfg=config({});
const vid=(n:number)=>'vid'+String(n).padStart(8,'0');
const channels:Record<number,[string,string[]]>={1:['三立新聞',['泛綠','台灣立場']],2:['TVBS NEWS',['泛藍']],3:['公視新聞網',['公共電視']],4:['民視新聞',['泛綠']],5:['東森新聞',['泛藍']],6:['華視新聞',['公共電視']]};
/** createTaggedVideoTables(): v{n} belongs to channel ((n-1)%6)+1, views 100000-n. */
const video=(n:number,position:number):Video=>{const uId=((n-1)%6)+1,[channel,tags]=channels[uId]!;return {videoId:vid(n),title:'第'+n+'支事件影片',uId,channel,tags,group:groups.find(g=>tags.includes(g))??'其他',views:100000-n,publishedAt:'2026-05-24 10:00:00',url:'https://www.youtube.com/watch?v='+vid(n),position};};
/** TelegramEventEnricher over the fixture tables (videos missing from urt_video are skipped). */
function enrich(event:Event,present=(n:number)=>n<=30):Event{
 const videos=event.videoIds.flatMap((id,position)=>{const n=Number(id.slice(3));return present(n)?[video(n,position)]:[];}).sort((a,b)=>(b.views??-1)-(a.views??-1)||a.position-b.position);
 const reports=event.mediaReports.map(r=>{const v=videos.find(v=>v.uId===r.uId);return {...r,tags:v?.tags??[],group:v?.group??'其他'};});
 return {...event,videos,mediaReports:reports,mediaCount:Math.max(event.mediaCount,new Set(videos.map(v=>'u:'+v.uId)).size)};
}
const hourContext=(from:string):Context=>({period:'hourly',key:'h:'+from,label:from.slice(0,10)+' '+from.slice(11,13)+'時',url:'https://youtube.observe.tw/ai/hours?date='+from.slice(0,10),dateFrom:from,dateTo:from.slice(0,14)+'59:59',sourceTable:'urt_ai_hour',sourcePk:'1',sourceHash:'x',snapshotHash:'x',aiRunId:null,events:[]});
const dayContext:Context={...hourContext('2026-05-24 00:00:00'),period:'daily',key:'d:2026-05-24',label:'2026-05-24',url:'https://youtube.observe.tw/ai/days/2026-05-24',sourceTable:'urt_ai_date'};
const range=(a:number,b:number)=>Array.from({length:b-a+1},(_,i)=>vid(a+i));
const hourly=(raw:Record<string,unknown>,ids:string[])=>enrich(normalizeEvent({...raw,videoId:ids},0));
const storyRow=(state:ReturnType<typeof decide>,extra:Record<string,unknown>)=>({id:7,fingerprint_json:JSON.stringify(state.merged),video_ids_json:JSON.stringify(state.videoIds),video_channels_json:JSON.stringify(state.videoChannels),observations_json:JSON.stringify(state.obs),last_posted_video_ids_json:JSON.stringify(state.videoIds),post_count:1,...extra}) as never;

describe('TelegramDigestFormatter parity',()=>{
 const post=(o:Partial<FormatterPost>={}):FormatterPost=>({title:'毒駕致死案引發修法討論',summary:'近日多起毒駕致死案件引發關注，三立聚焦肇事責任，TVBS整理修法進度。',description:'行政院與立法院討論加重刑責。',category:'公共安全',angle:'司法與修法',camp:'跨陣營',keywords:['毒駕','交通安全','修法'],people:['卓榮泰','鍾小平'],places:['台北'],video_count:18,media_count:6,group_video_counts:{泛綠:9,泛藍:6,公共媒體:3},videos:[{title:'毒駕撞死人只判緩刑',channel:'三立新聞',tags:['泛綠','台灣立場'],group:'泛綠',url:'https://www.youtube.com/watch?v=green1'},{title:'卓榮泰承諾加速修法',channel:'TVBS NEWS',tags:['泛藍'],group:'泛藍',url:'https://www.youtube.com/watch?v=blue1'}],recommendations:[],url:'https://youtube.observe.tw/ai/days/2026-05-24',label:'2026-05-24',...o});
 it('renders compact metadata and expandable source coverage',()=>{
  const m=formatLaravelPost(post());
  for(const s of ['<b>毒駕致死案引發修法討論</b>','⏱ 影片18｜來源頻道6','分類公共安全｜角度司法與修法｜陣營跨陣營','▸ 影片分布　泛綠9支、泛藍6支、公共媒體3支','# 毒駕、交通安全、修法','人物　卓榮泰、鍾小平｜地名　台北','<blockquote expandable>','<b>先看</b>','<b>三立新聞〔泛綠、台灣立場〕</b>','href="https://www.youtube.com/watch?v=green1"','<b>TVBS NEWS〔泛藍〕</b>','<a href="https://youtube.observe.tw/ai/days/2026-05-24">完整整理</a>'])expect(m).toContain(s);
  for(const s of ['行政院與立法院討論加重刑責。','\n\n分類公共安全','<br'])expect(m).not.toContain(s);
  expect(m).toBe('<a href="https://youtube.observe.tw/ai/days/2026-05-24"><b>毒駕致死案引發修法討論</b></a>\n⏱ 影片18｜來源頻道6\n分類公共安全｜角度司法與修法｜陣營跨陣營\n▸ 影片分布　泛綠9支、泛藍6支、公共媒體3支\n# 毒駕、交通安全、修法\n人物　卓榮泰、鍾小平｜地名　台北\n\n<blockquote expandable>近日多起毒駕致死案件引發關注，三立聚焦肇事責任，TVBS整理修法進度。\n\n<b>先看</b>\n<b>三立新聞〔泛綠、台灣立場〕</b>　<a href="https://www.youtube.com/watch?v=green1">毒駕撞死人只判緩刑</a>\n<b>TVBS NEWS〔泛藍〕</b>　<a href="https://www.youtube.com/watch?v=blue1">卓榮泰承諾加速修法</a></blockquote>\n\n↗ <a href="https://youtube.observe.tw/ai/days/2026-05-24">完整整理</a> · 2026-05-24');
 });
 it('omits optional metadata when absent',()=>{const m=formatLaravelPost(post({people:[],places:[],media_count:0,group_video_counts:{}}));for(const s of ['人物　','地名　','媒體0','影片分布　'])expect(m).not.toContain(s);expect(m).toContain('影片18');});
 it('names the previous push time and drops video-title branding',()=>{
  const m=formatLaravelPost(post({metric_line:'上次推播後｜新增影片12｜新增頻道3',previous_posted_at:'2026-05-24T02:00:00+00:00',videos:[{title:'【每日必看】熊本震後交通與搜救持續進行│TVBS新聞 20260801',channel:'TVBS NEWS',tags:['泛藍'],group:'泛藍',url:'https://www.youtube.com/watch?v=blue1'},{title:'直播／熊本商店街震後仍冷清【最新快訊】 #newsebc',channel:'東森新聞 CH51',tags:['其他'],group:'其他',url:'https://www.youtube.com/watch?v=other1'}]}));
  for(const s of ['⏱ 上次推播後（前次 05/24 10:00）｜新增影片12｜新增頻道3','熊本震後交通與搜救持續進行</a>','熊本商店街震後仍冷清</a>'])expect(m).toContain(s);
  for(const s of ['每日必看','TVBS新聞 20260801','最新快訊','#newsebc'])expect(m).not.toContain(s);
  expect(formatLaravelPost(post({metric_line:'上次推播後｜新增影片1｜新增頻道1',previous_posted_at:'2026-05-24 02:00:00'}))).toContain('（前次 05/24 10:00）');
 });
 it('escapes text with & < > only and attributes with htmlspecialchars',()=>{
  const m=formatLaravelPost(post({title:'A & B <live>',summary:'x > y & z',description:'',keywords:[],people:[],videos:[{title:'A&B <片>',channel:'C&D',tags:[],group:'其他',url:'https://www.youtube.com/watch?v=a&list=b'}]}));
  expect(m).toContain('<b>A &amp; B &lt;live&gt;</b>');expect(m).toContain('x &gt; y &amp; z');expect(m).toContain('href="https://www.youtube.com/watch?v=a&amp;list=b"');expect(m).not.toContain('<live>');
  expect(formatLaravelPost(post({title:'「他說」\'quote\'',videos:[]}))).toContain('<b>「他說」\'quote\'</b>');
 });
 it('trims long video titles to 56 characters with an ellipsis',()=>{expect(formatLaravelPost(post({videos:[{title:'測試中，'.repeat(20),channel:'測試新聞台',tags:['其他'],group:'其他',url:'https://www.youtube.com/watch?v=utf8'}]}))).toContain('…</a>');expect(shortVideoTitle('測試中，'.repeat(20),'x')).toBe('測試中，'.repeat(14).slice(0,-1)+'…');expect(shortVideoTitle('颱風來襲－三立新聞','三立新聞')).toBe('颱風來襲');expect(shortVideoTitle('｜開頭','x')).toBe('查看影片');});
 it('budgets the summary in visible UTF-16 units and keeps both links',()=>{
  for(const summary of ['長句子。'.repeat(2000),'📊'.repeat(4000)]){const m=formatLaravelPost(post({summary}));expect(visibleLength(m)).toBeLessThanOrEqual(4096);for(const s of ['<blockquote expandable>','watch?v=green1','watch?v=blue1','完整整理'])expect(m).toContain(s);}
  expect(formatLaravelPost(post({summary:'長句子。'.repeat(2000)}))).toContain('…');
 });
 it('includes as many video links as fit and reports the remainder',()=>{const videos=Array.from({length:160},(_,i)=>({title:'完整新聞標題'.repeat(6)+(i+1),channel:'新聞台'+(i+1),tags:[(i+1)%2===0?'泛藍':'泛綠'],group:(i+1)%2===0?'泛藍':'泛綠',url:'https://www.youtube.com/watch?v=video'+(i+1)}));const m=formatLaravelPost(post({summary:'事件摘要。',description:'',videos,video_count:160}));const n=(m.match(/youtube\.com\/watch\?v=video\d+/g)??[]).length;expect(n).toBeGreaterThan(2);expect(n).toBeLessThan(160);expect(m).toMatch(/其餘\d+支見完整整理/);expect(visibleLength(m)).toBeLessThanOrEqual(4096);expect(m).toContain('\n<b>泛綠</b>\n');});
});

describe('EventNewsWriter parity',()=>{
 const asEvent=(o:Partial<Event>)=>({...normalizeEvent({事件:o.title??'x'},0),...o}) as Event;
 const ai=(items:unknown[],seen?:(plan:{system?:string;prompt:string})=>void)=>({complete:async(plan:{system?:string;prompt:string})=>{seen?.(plan);return {content:JSON.stringify({items}),model:'gateway-model',requestedModel:'sky-quality',usage:null};}});
 it('maps original titles to generated summaries and sends the verbatim Laravel prompt and payload',async()=>{
  let plan:{system?:string;prompt:string}|undefined;
  const briefs=await writeBriefs([asEvent({title:'毒駕事件',keywords:['毒駕']}),asEvent({title:'颱風/動態',keywords:['颱風']})],ai([{title:'毒駕事件',summary:'摘要一'},{title:'颱風/動態',summary:' 摘要二 '}],p=>{plan=p;}));
  expect(briefs.map(b=>b.summary)).toEqual(['摘要一','摘要二']);expect(briefs.map(b=>b.headline)).toEqual(['毒駕事件','颱風/動態']);
  expect(plan?.system).toBe(NEWS_WRITER_SYSTEM);expect(NEWS_WRITER_SYSTEM).toContain('不可把問句改成確定結論');expect(NEWS_WRITER_SYSTEM).toContain('不能當成已核實事實');expect(NEWS_WRITER_SYSTEM.startsWith('你是「臺灣 YouTube 新聞觀測站」Telegram 頻道的編輯。')).toBe(true);expect(NEWS_WRITER_SYSTEM).toContain('\n\n嚴格規則：\n1. ');expect(NEWS_WRITER_SYSTEM.endsWith('items 的順序與數量必須對應輸入事件。')).toBe(true);
  expect(plan?.prompt.startsWith('{\n    "events": [\n        {\n            "title": "毒駕事件",\n            "description": "",')).toBe(true);
  expect(plan?.prompt).toContain('"title": "颱風\\/動態"');expect(plan?.prompt).toContain('"media_reports": [],\n            "group_video_counts": [],\n            "videos": [],\n            "video_count": 0,\n            "media_count": 0');
 });
 it('returns no AI call for no events and empty copy without named sources on failure',async()=>{let calls=0;expect(await writeBriefs([],{complete:async()=>{calls++;throw Error('x');}})).toEqual([]);expect(calls).toBe(0);expect((await writeBriefs([asEvent({title:'毒駕事件',keywords:['毒駕']})],{complete:async()=>{throw Error('500');}}))[0]).toMatchObject({summary:'',aiOutcome:'failed'});});
 it('accepts a display headline only with known video evidence and keeps the identity title',async()=>{
  const headline='沈伯洋赴信義區拜廟，批蔣市府「不知道在做什麼」',v={...video(1,0),videoId:'41fj51cAmr0',channel:'三立新聞LIVE',title:'沈伯洋信義區拜廟 批蔣市府不知道在做什麼'};
  const [brief]=await writeBriefs([asEvent({title:'沈伯洋掃街與互動活動',videos:[v]})],ai([{title:'沈伯洋掃街與互動活動',headline,headline_video_ids:['41fj51cAmr0'],summary:'三立新聞LIVE報導沈伯洋赴信義區拜廟並批評蔣市府。'}]));
  expect(brief).toMatchObject({headline,evidence:['41fj51cAmr0'],kind:'generated',aiOutcome:'accepted'});
  const known={...video(1,0),videoId:'knownvideo1',channel:'中天新聞',title:'介文汲：66架F-16恐延到2030'},h='介文汲稱F-16交付恐延至2030年';
  for(const variant of [{},{headline:h,headline_video_ids:[]},{headline:h,headline_video_ids:['invented']},{headline:h,headline_video_ids:['knownvideo1','invented']},{headline:h,headline_video_ids:[['knownvideo1']]},{headline:['wrong type'],headline_video_ids:['knownvideo1']},{headline:'軍售議題',headline_video_ids:['knownvideo1']},{headline:'字'.repeat(65),headline_video_ids:['knownvideo1']},{headline:h+'\n額外一行',headline_video_ids:['knownvideo1']}]){
   const [b]=await writeBriefs([asEvent({title:'習川會後分析',videos:[known]})],ai([{title:'習川會後分析',summary:'中天新聞引述介文汲對軍售交付時程的推測。',...variant}]));
   expect(b).toMatchObject({headline:'習川會後分析',summary:'中天新聞引述介文汲對軍售交付時程的推測。'});
  }
 });
 it('keeps a valid headline but replaces an unnamed-source summary with grounded fallback copy',async()=>{
  const headline='沈伯洋赴信義區拜廟，批蔣市府「不知道在做什麼」';
  const [b]=await writeBriefs([asEvent({title:'沈伯洋公開行程',description:'沈伯洋赴信義區拜廟。',videos:[{...video(1,0),videoId:'abcdefghij1',channel:'三立新聞LIVE',title:'沈伯洋信義區拜廟 批蔣市府不知道在做什麼'},{...video(2,1),videoId:'abcdefghij2',channel:'三立新聞網SETN',title:'沈伯洋信義區拜廟 與民眾握手'}]})],ai([{title:'沈伯洋公開行程',headline,headline_video_ids:['abcdefghij1'],summary:'部分頻道報導沈伯洋拜廟。'}]));
  expect(b?.headline).toBe(headline);expect(b?.summary).not.toContain('部分頻道');expect(b?.summary).toContain('三立新聞LIVE');expect(b?.summary).toContain('三立新聞網SETN');
  // Laravel hands the writer videos without group/u_id, so hourly video paragraphs are attributed to 其他.
  expect(b?.summary).toBe('沈伯洋赴信義區拜廟。\n\n其他來源中，三立新聞LIVE著重沈伯洋信義區拜廟 批蔣市府不知道在做什麼。\n\n其他來源中，三立新聞網SETN著重沈伯洋信義區拜廟 與民眾握手。');
 });
 it('fallback keeps four grounded short paragraphs in group order and removes title noise',()=>{
  const reports=laravelFallback({title:'熊本震後救援進度',description:'熊本震後持續搜救並修復交通。',keywords:['熊本強震','搜救','新幹線'],group_video_counts:{泛綠:8,泛藍:5},media_reports:[{channel:'三立新聞',description:'追蹤物資集散與災區支援。',group:'泛綠'},{channel:'TVBS NEWS',description:'整理道路與新幹線受損情況。',group:'泛藍'}] as never}).split('\n\n');
  expect(reports).toEqual(['熊本震後持續搜救並修復交通。','泛綠來源中，三立新聞著重追蹤物資集散與災區支援。','泛藍來源中，TVBS NEWS著重整理道路與新幹線受損情況。','整體報導共同關注熊本強震、搜救、新幹線等進展。']);
  const videos=laravelFallback({title:'熊本震後救援進度',description:'熊本震後持續搜救並修復交通。',keywords:['熊本強震','搜救'],group_video_counts:{泛綠:8,泛藍:5},videos:[{channel:'三立新聞',group:'泛綠',title:'【#直播中LIVE】熊本物資集散與災區支援｜三立新聞 @setn'},{channel:'TVBS NEWS',group:'泛藍',title:'【國際懶人包】新幹線與道路修復進度｜TVBS新聞 @tvbsnews01'}] as never}).split('\n\n');
  expect(videos).toHaveLength(4);expect(videos[1]).toBe('泛綠來源中，三立新聞著重熊本物資集散與災區支援。');expect(videos[2]).toBe('泛藍來源中，TVBS NEWS著重新幹線與道路修復進度。');expect(videos.join()).not.toMatch(/LIVE|@|｜/);
  expect(laravelFallback({title:'只有一家',description:'描述',videos:[{channel:'甲',title:'標題'}] as never})).toBe('');
 });
 it('PHP pretty JSON escapes slashes and line separators like json_encode',()=>{expect(phpPrettyJson({a:['x/y','\u2028'],b:[]})).toBe('{\n    "a": [\n        "x\\/y",\n        "\\u2028"\n    ],\n    "b": []\n}');});
});

describe('TelegramDigestBroadcaster / StoryTracker parity',()=>{
 const hourRaw={事件:'毒駕修法進度',描述:'行政院與立法院持續討論修法。',分類:['公共安全'],角度:'司法與修法',陣營:'跨陣營',關鍵字:['毒駕','修法'],人物:['卓榮泰'],地名:['台北']};
 it('hourly post shows system tags, distribution, metadata, direct links and the Laravel fallback copy',async()=>{
  const event=hourly(hourRaw,range(1,8)),context=hourContext('2026-05-24 10:00:00'),state=decide(event,context,cfg,undefined,new Date('2026-05-24T10:05:00Z'));
  expect(state.decision).toMatchObject({shouldPost:true,trigger:'first',metricLine:'近1小時｜影片8｜來源頻道6'});
  const [post]=await renderPosts([{event,decision:state.decision}],context);
  expect(post?.complete).toBe(true);expect(post?.previewUrl).toBe('https://www.youtube.com/watch?v='+vid(1));
  for(const s of ['<blockquote expandable>','⏱ 近1小時｜影片8｜來源頻道6','▸ 影片分布　泛綠3支、泛藍3支、公共電視2支','分類公共安全｜角度司法與修法｜陣營跨陣營','# 毒駕、修法','人物　卓榮泰｜地名　台北','三立新聞〔泛綠、台灣立場〕','TVBS NEWS〔泛藍〕','https://www.youtube.com/watch?v='+vid(1)])expect(post?.html).toContain(s);
  expect(post?.brief.summary).toBe('行政院與立法院持續討論修法。\n\n其他來源中，三立新聞著重第1支事件影片。\n\n其他來源中，TVBS NEWS著重第2支事件影片。\n\n整體報導共同關注毒駕、修法等進展。');
 });
 it('preview distribution counts unresolved video IDs as 其他',async()=>{
  const event=hourly({事件:'毒駕修法進度',描述:'行政院與立法院持續討論修法。',關鍵字:['毒駕','修法']},range(1,9)),context=hourContext('2026-05-24 10:00:00');const e2=enrich(normalizeEvent({事件:'毒駕修法進度',描述:'行政院與立法院持續討論修法。',關鍵字:['毒駕','修法'],videoId:range(1,9)},0),n=>n<=8);
  expect(event.videos).toHaveLength(9);const state=decide(e2,context,cfg,undefined,new Date('2026-05-24T10:05:00Z'));const [post]=await renderPosts([{event:e2,decision:state.decision}],context);
  expect(post?.html).toContain('⏱ 近1小時｜影片9｜來源頻道6');expect(post?.html).toContain('▸ 影片分布　泛綠3支、泛藍3支、公共電視2支、其他1支');
 });
 it('follow-up after 24 hours uses counts since the previous push and its Taipei time',async()=>{
  const first=hourly({事件:'毒駕修法進度',關鍵字:['毒駕','修法']},range(1,8)),c1=hourContext('2026-05-24 10:00:00'),s1=decide(first,c1,cfg,undefined,new Date('2026-05-24T10:05:00Z'));
  const next=hourly({事件:'毒駕修法進度',關鍵字:['毒駕','修法']},range(9,13)),c2=hourContext('2026-05-25 10:00:00');
  const state=decide(next,c2,cfg,storyRow(s1,{last_posted_at:'2026-05-24 10:05:00'}),new Date('2026-05-25T10:05:00Z'));
  expect(state.decision).toMatchObject({shouldPost:true,trigger:'update'});
  const html=formatPost(next,c2,state.decision,{headline:next.title,summary:'修法出現新的討論進度。',evidence:[],kind:'generated',model:null,requestedModel:null,promptHash:null,usage:null,aiOutcome:'accepted'},recommend(next));
  expect(html).toContain('上次推播後（前次 05/24 18:05）｜新增影片5｜新增頻道5');expect(html).toContain('▸ 影片分布　泛綠2支、公共電視2支、泛藍1支');
 });
 it('burst override posts after three prior low-activity hours',()=>{
  const first=hourly({事件:'毒駕修法進度',關鍵字:['毒駕','修法']},range(1,8)),s1=decide(first,hourContext('2026-05-24 10:00:00'),cfg,undefined,new Date('2026-05-24T10:05:00Z'));
  const obs=[...s1.obs,...[11,12,13].map(h=>({context_key:'h:2026-05-24 '+h+':00:00',observed_at:'2026-05-24 '+h+':00:00',video_count:2,media_count:2}))];
  const burst=hourly({事件:'毒駕修法進度',關鍵字:['毒駕','修法']},[vid(1),vid(2),vid(3),vid(4),vid(9),vid(10),vid(11),vid(12)]);
  const state=decide(burst,hourContext('2026-05-24 14:00:00'),cfg,storyRow(s1,{observations_json:JSON.stringify(obs),last_posted_at:'2026-05-24 10:05:00'}),new Date('2026-05-24T14:05:00Z'));
  expect(state.decision).toMatchObject({shouldPost:true,trigger:'burst',metricLine:'上次推播後｜新增影片4｜新增頻道4',burstLine:'近1小時｜影片8｜來源頻道6｜為前3小時均值4倍'});
  // Laravel never evaluates a burst for daily posts, even when the story carries hourly observations.
  expect(decide(burst,dayContext,cfg,storyRow(s1,{observations_json:JSON.stringify(obs),last_posted_at:null}),new Date('2026-05-24T14:05:00Z')).decision).toMatchObject({trigger:'daily',burstLine:''});
 });
 it('title variants with CJK punctuation normalize to the same Laravel story fingerprint',()=>{const a=fingerprint(hourly({事件:'「毒駕」修法，進度！'},[])),b=fingerprint(hourly({事件:'毒駕修法進度'},[]));expect(a.title).toBe(b.title);expect(a.title).toBe('毒駕修法進度');});
});

describe('daily topic projection parity',()=>{
 const topicRow={標題:'毒駕事件',媒體事件:{三立新聞:['三立毒駕追蹤'],'TVBS NEWS':['TVBS修法追蹤']}};
 const cache={毒駕事件:{媒體數:2,影片數:3,videos:{1:[vid(1),vid(3)],2:[vid(2)]},角度:{台灣:3},陣營:{民進黨:2,國民黨:1},關鍵字:{毒駕:2,修法:1},關鍵字次數:{毒駕:3,修法:1},人物:{卓榮泰:2},地名:{台北:1},標籤:{1:2,2:1},媒體明細:[{u_id:1,媒體:'三立新聞',事件:'三立毒駕追蹤',描述:'三立整理事故責任與受害者家屬訴求。',分類:'公共安全',角度:'台灣',陣營:'民進黨',關鍵字:['毒駕'],人物:['卓榮泰'],地名:['台北'],videoId:[vid(1),vid(3)]},{u_id:2,媒體:'TVBS NEWS',事件:'TVBS修法追蹤',描述:'TVBS追蹤行政院與立法院修法進度。',分類:'公共安全',角度:'台灣',陣營:'國民黨',關鍵字:['修法'],人物:['卓榮泰'],地名:['台北'],videoId:[vid(2)]}]}};
 it('hydrates from the cached data_json topic map like hydrateDailyEvents and posts the top complete event',async()=>{
  const base=normalizeEvent(topicRow,0);expect(base.media).toEqual(['三立新聞','TVBS NEWS']);
  const parsed=JSON.parse(JSON.stringify(cache));expect(usableTopicCache([base],parsed)).toBe(true);expect(usableTopicCache([base],{...parsed,毒駕事件:{...parsed.毒駕事件,媒體明細:[]}})).toBe(false);
  const event=enrich(hydrateDaily(base,parsed.毒駕事件));
  expect(event).toMatchObject({videoIds:[vid(1),vid(3),vid(2)],videoCount:3,mediaCount:3,keywords:['毒駕','修法'],people:['卓榮泰'],places:['台北'],angle:'台灣',camp:'民進黨、國民黨',category:'公共安全'});
  const state=decide(event,dayContext,cfg,undefined,new Date('2026-05-25T01:00:00Z'));const [post]=await renderPosts([{event,decision:state.decision}],dayContext);
  expect(post?.complete).toBe(true);
  for(const s of ['毒駕事件','泛綠來源中，三立新聞著重三立整理事故責任與受害者家屬訴求。','泛藍來源中，TVBS NEWS著重TVBS追蹤行政院與立法院修法進度。','⏱ 昨日整理｜影片3｜來源頻道3','<b>先看</b>','分類公共安全｜角度台灣｜陣營民進黨、國民黨'])expect(post?.html).toContain(s);
 });
 it('projects production-shaped channel events exactly like AiTopicProjector when the cache is missing',()=>{
  const stats=topicStats([{uId:1,channel:'三立新聞',name:'三立救援追蹤',raw:{事件:'三立救援追蹤',描述:'三立新聞整理救援進度與餘震影響。',分類:'國際',角度:'台灣',陣營:'民進黨',關鍵字:['熊本強震','救援'],人物:['高市早苗'],地名:['熊本'],videoId:[vid(1),vid(7)]}},{uId:2,channel:'TVBS NEWS',name:'TVBS餘震追蹤',raw:{事件:'TVBS餘震追蹤',描述:'TVBS NEWS追蹤餘震與交通恢復情形。',分類:'國際',角度:'中國',陣營:'國民黨',關鍵字:['熊本強震','餘震'],人物:['高市早苗'],地名:['熊本'],videoId:[vid(2)]}}]);
  const event=hydrateDaily(normalizeEvent({標題:'熊本強震救援進展',媒體事件:{三立新聞:['三立救援追蹤'],'TVBS NEWS':['TVBS餘震追蹤']}},0),stats);
  expect(event).toMatchObject({videoIds:[vid(1),vid(7),vid(2)],mediaCount:2,keywords:['熊本強震','救援','餘震'],people:['高市早苗'],places:['熊本'],angle:'台灣、中國',camp:'民進黨、國民黨',category:'國際'});
  const fallback=laravelFallback({...enrich(event),media_reports:enrich(event).mediaReports.map(r=>({channel:r.channel,description:r.description,group:r.group})),group_video_counts:{泛綠:2,泛藍:1}} as never);
  expect(fallback).toContain('泛綠來源中，三立新聞著重三立新聞整理救援進度與餘震影響。');expect(fallback).toContain('泛藍來源中，TVBS NEWS著重TVBS NEWS追蹤餘震與交通恢復情形。');
 });
 it('a missing topic leaves an empty incomplete event, and daily needs two reporting channels',async()=>{
  const empty=hydrateDaily(normalizeEvent(topicRow,0),undefined);expect(empty).toMatchObject({videoIds:[],videoCount:0,mediaCount:0,mediaReports:[],keywords:[],category:''});
  const one=enrich(hydrateDaily(normalizeEvent(topicRow,0),{...cache.毒駕事件,媒體明細:[cache.毒駕事件.媒體明細[0]]} as never));const state=decide(one,dayContext,cfg,undefined,new Date('2026-05-25T01:00:00Z'));
  expect((await renderPosts([{event:one,decision:state.decision}],dayContext))[0]?.complete).toBe(false);
 });
});

describe('notification gateway client',()=>{
 it('sends the Laravel system prompt as json_object through the gateway alias and fails over only when unreachable',async()=>{
  const urls:string[]=[];let body:Record<string,any>={};
  const client=new NotificationProvider({OPENAI_API_KEY:'fake',OPENAI_BASE_URL:'http://172.17.0.1:8317/v1'},async(url,init)=>{urls.push(String(url));if(urls.length===1)throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNREFUSED'}});body=JSON.parse(String(init?.body));return new Response(JSON.stringify({choices:[{message:{content:'{"items":[]}'}}]}));},async()=>{});
  const result=await client.complete({input:{kind:'notification'},prompt:'payload',schema:{},system:NEWS_WRITER_SYSTEM} as never);
  expect(urls).toEqual(['http://172.17.0.1:8317/v1/chat/completions','http://100.85.214.25:8317/v1/chat/completions']);
  expect(body).toEqual({model:'sky-quality',messages:[{role:'system',content:NEWS_WRITER_SYSTEM},{role:'user',content:'payload'}],max_completion_tokens:8000,reasoning_effort:'low',response_format:{type:'json_object'}});
  expect(result).toMatchObject({model:'sky-quality',requestedModel:'sky-quality',gateway:'100.85.214.25:8317'});
  let calls=0;const timeout=new NotificationProvider({OPENAI_API_KEY:'fake'},async()=>{calls++;throw new DOMException('timeout','TimeoutError');},async()=>{});await expect(timeout.complete({input:{kind:'notification'},prompt:'p',schema:{}})).rejects.toThrow();expect(calls).toBe(1);
  expect(()=>new NotificationProvider({OPENAI_API_KEY:'fake',TELEGRAM_OPENAI_TIMEOUT:'270'})).not.toThrow();expect(()=>new NotificationProvider({OPENAI_API_KEY:'fake',TELEGRAM_OPENAI_TIMEOUT:'3000'})).toThrow();
  const omitted=new NotificationProvider({OPENAI_API_KEY:'fake',TELEGRAM_OPENAI_REASONING_EFFORT:''},async(_u,init)=>{body=JSON.parse(String(init?.body));return new Response(JSON.stringify({model:'m',choices:[{message:{content:'{}'}}]}));});await omitted.complete({input:{kind:'notification'},prompt:'p',schema:{}});expect(body).not.toHaveProperty('reasoning_effort');
 });
});
