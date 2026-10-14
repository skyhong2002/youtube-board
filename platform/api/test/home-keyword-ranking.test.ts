import {expect,it} from 'vitest';
import {channelHeat,keywordDisplayMap,rankKeywordWindows} from '../src/reports/home-keyword-ranking.js';
it('weights titles three to one and geometrically limits a single channel',()=>{
 expect(channelHeat(0,1)).toBe(1);expect(channelHeat(1,0)).toBe(3);expect(channelHeat(2,0)).toBe(4.5);expect(channelHeat(1,2)).toBe(3.75);expect(channelHeat(0,1000)).toBe(2);expect(channelHeat(1000,0)).toBe(6);
});
it('preserves exact source aliases and removes only upstream display exclusions',()=>{
 const d=keywordDisplayMap([{term_key:'b',term:'OPENAI',group_name:'openai'},{term_key:'a',term:'OpenAI',group_name:'openai'},{term_key:'c',term:'政治',group_name:'政治'}]);
 expect(d.groups.get('openai')).toEqual({key:'a',term:'OpenAI',sourceTerms:[{key:'a',term:'OpenAI'},{key:'b',term:'OPENAI'}]});expect(d.excluded).toEqual(['c']);expect(d.exclusions.terms).toBe(1);
});
it('adds independently decayed channels and exposes an honest sparse baseline',()=>{
 const d=keywordDisplayMap([{term_key:'a',term:'OpenAI',group_name:'openai'}]);
 const rows=[{window_key:'week',group_name:'openai',u_id:1,videos:2,title_videos:2,measured_videos:1,known_views:100},{window_key:'week',group_name:'openai',u_id:2,videos:2,title_videos:0,measured_videos:2,known_views:80},{window_key:'prior-week',group_name:'openai',u_id:1,videos:1,title_videos:1,measured_videos:1,known_views:10},{window_key:'2035-01-03',group_name:'openai',u_id:1,videos:2,title_videos:2,measured_videos:1,known_views:100}];
 const result=rankKeywordWindows(rows,d,[{date:'2035-01-02',complete:false},{date:'2035-01-03',complete:true},{date:'2035-01-04',complete:true}],{week:true,today:false});
 expect(result.week[0]).toMatchObject({videoCount:4,titleVideos:2,descriptionOnlyVideos:2,channelCount:2,heatScore:6,rise:3,knownViews:180,views:null,measuredViewVideos:3,unknownViewVideos:1,trend:[{date:'2035-01-02',heat:null},{date:'2035-01-03',heat:4.5},{date:'2035-01-04',heat:0}]});
 expect(rankKeywordWindows(rows,d,[],{week:false,today:false}).week[0]?.rise).toBeNull();
});
it('does not turn unsafe counts or known-view subtotals into rounded metrics',()=>{
 const d=keywordDisplayMap([{term_key:'a',term:'OpenAI',group_name:'openai'}]);
 const base={window_key:'week',group_name:'openai',u_id:1,videos:1,title_videos:1,measured_videos:1,known_views:100};
 expect(()=>rankKeywordWindows([{...base,known_views:'9007199254740993'}],d,[],{week:false,today:false})).toThrow('precision');
 expect(()=>rankKeywordWindows([{...base,measured_videos:2}],d,[],{week:false,today:false})).toThrow('precision');
});
it('combines daily bins before channel decay without resetting saturation at midnight',()=>{
 const d=keywordDisplayMap([{term_key:'a',term:'OpenAI',group_name:'openai'}]);
 const base={group_name:'openai',u_id:1,videos:1,title_videos:1,measured_videos:1,known_views:20,in_week:1,in_today:0,in_prior_week:0,in_prior_today:0};
 const rows=[{...base,bucket_date:'2035-01-07'},{...base,bucket_date:'2035-01-08',in_today:1}];
 const r=rankKeywordWindows(rows,d,[{date:'2035-01-07',complete:true},{date:'2035-01-08',complete:true}],{week:false,today:false});
 expect(r.week[0]).toMatchObject({videoCount:2,channelCount:1,heatScore:4.5,knownViews:40,trend:[{date:'2035-01-07',heat:3},{date:'2035-01-08',heat:3}]});expect(r.today[0]).toMatchObject({videoCount:1,heatScore:3});
});
it('keeps the raw pool immutable while applying authorized platform display exclusions',()=>{
 const raw=[{term_key:'a',term:'YouTube'},{term_key:'b',term:'youtube'},{term_key:'c',term:'沈伯洋'},{term_key:'d',term:'看'}],before=JSON.stringify(raw);
 const d=keywordDisplayMap(raw);expect(d.excluded.sort()).toEqual(['a','b','d']);expect(d.groups.size).toBe(1);expect(JSON.stringify(raw)).toBe(before);expect(d.exclusions.youtubePolicyVersion).toBe('youtube-platform-display-v3');
});
it('SQL per-window channel aggregates preserve exact JS heat, missing views and rise semantics',()=>{
 const d=keywordDisplayMap([{term_key:'a',term:'OpenAI'}]);
 const common={window_key:'week',g:'a'},raw=[{...common,c:1,n:3,t:1,m:2,v:100},{...common,c:2,n:2,t:2,m:2,v:70}];
 const summed=[{...common,n:5,t:3,m:4,v:170,channel_count:2,heat_score:channelHeat(1,2)+channelHeat(2,0)}];
 expect(rankKeywordWindows(summed,d,[],{week:false,today:false})).toEqual(rankKeywordWindows(raw,d,[],{week:false,today:false}));
 for(const change of [{channel_count:6},{heat_score:-1},{heat_score:13},{m:6}])expect(()=>rankKeywordWindows([{...summed[0],...change}],d,[],{week:false,today:false})).toThrow('precision');
});


it('the common ranking pool excludes audited generic and geographic terms while preserving named subjects and raw keys',()=>{
 const generic='支持 登場 粉絲 真相 曝光 未來 市場 打造 持續 公開 畫面 危機 影響 服務 感謝 攻擊 互動 投資 安全 挑戰 成功 相關 歷史 關注'.split(' ');
 const geographic=['中共','北京','烏克蘭'];
 const retained=['沈伯洋','川普','台積電','國慶','雙十國慶','AI','假新聞','新聞自由','烏克蘭戰爭','中共軍演','市場改革','支持者'];
 const raw=[...generic,...geographic,'美國','民進黨','Yahoo','合作媒體',...retained].map((term,i)=>({term_key:`k${i}`,term}));const before=JSON.stringify(raw);
 const display=keywordDisplayMap(raw);
 expect([...display.groups.values()].map(g=>g.term)).toEqual(retained);
 expect(display.exclusions.reasons).toMatchObject({'youtube-generic-two-character':24,'youtube-country-city-party':3,'upstream-no-equal-or-category':2,'youtube-source-or-platform':2});
 const rows=[...display.groups.values()].flatMap((g,i)=>['today','week'].map(window_key=>({window_key,g:g.key,n:1,t:1,m:1,v:100+i,channel_count:1,heat_score:3})));
 const ranked=rankKeywordWindows(rows,display,[],{week:false,today:false});
 for(const period of [ranked.today,ranked.week])expect(period.map(r=>r.term).sort()).toEqual([...retained].sort());
 expect(JSON.stringify(raw)).toBe(before);
});
