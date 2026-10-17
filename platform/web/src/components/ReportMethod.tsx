import type {ReactNode} from 'react';
import type {ReportMeta} from '@/lib/api';
import PageMethod from './PageMethod';
import {AiMethod,ChannelMethod,CloudMethod,CommentMethod,GroupMethod,KeywordMethod,LiveMethod,MayorMethod,PageNotes,SourceMethod,TagMethod,VideoMethod} from './MethodNotes';

// Which blocks explain which report pages (tag.observe.tw FooterMethod sectionsFor);
// every report ends with 資料來源. Paths are the public, decoded-or-encoded report paths.
function blocksFor(path:string):ReactNode{
 const p=path.replace(/\/$/,'');
 if(/^\/channels\/[^/]+\/(ai|people|prompt)(\/|$)/.test(p))return <><AiMethod/><ChannelMethod/></>;
 if(/^\/channels\/[^/]+\/comments$/.test(p))return <CommentMethod/>;
 if(/^\/channels\/[^/]+\/cloud$/.test(p))return <><CloudMethod/><ChannelMethod/></>;
 if(/^\/channels\/[^/]+\/videos$/.test(p))return <><VideoMethod/><ChannelMethod/></>;
 if(/^\/channels(\/|$)/.test(p))return <ChannelMethod/>;
 if(/^\/videos\/[^/]+$/.test(p))return <><VideoMethod/><KeywordMethod/></>;
 if(/^\/videos(\/|$)/.test(p)||p==='/tags/videos')return <VideoMethod/>;
 if(/^\/live\/tags$/.test(p))return <><LiveMethod/><TagMethod/></>;
 if(/^\/live(\/|$)/.test(p))return <LiveMethod/>;
 if(/^\/ai\/events\/[^/]+\/wall$/.test(p))return <><AiMethod/><LiveMethod/></>;
 if(/^\/ai(\/|$)/.test(p))return <AiMethod/>;
 if(/^\/tags\/(\d+\/)?channels$/.test(p))return <><TagMethod/><ChannelMethod/></>;
 if(/^\/tags\/(\d+\/)?videos$/.test(p))return <><TagMethod/><VideoMethod/></>;
 if(/^\/tags\/(\d+\/)?cloud$/.test(p))return <><TagMethod/><CloudMethod/></>;
 if(/^\/tags\/(\d+\/)?comments$/.test(p))return <><TagMethod/><CommentMethod/></>;
 if(/^\/tags\/(\d+\/)?live\/videos$/.test(p))return <><TagMethod/><LiveMethod/></>;
 if(/^\/tags(\/|$)/.test(p))return <TagMethod/>;
 if(/^\/keywords\/[^/]+\/cloud$/.test(p))return <><KeywordMethod/><CloudMethod/></>;
 if(/^\/keywords\/[^/]+\/live\/trends$/.test(p))return <><KeywordMethod/><LiveMethod/></>;
 if(/^\/keywords\/[^/]+\/groups\/trends$/.test(p))return <><KeywordMethod/><GroupMethod/></>;
 if(/^\/keywords(\/|$)/.test(p))return <KeywordMethod/>;
 if(/^\/groups(\/|$)/.test(p))return <GroupMethod/>;
 if(/^\/mayor(\/|$)/.test(p))return <MayorMethod/>;
 if(/^\/comments(\/|$)/.test(p))return <CommentMethod/>;
 return null;
}

/** Data-scope notes a report carries in its envelope; the fixture banner stays on the page. */
export function metaNotes(meta?:ReportMeta):string[]{
 if(!meta)return [];
 return meta.warnings.filter(w=>meta.dataset!=='fixture'||w!=='此環境使用合成範例 YouTube 資料。');
}

/** A report's 本頁的資料來源與計算方式: its blocks by path, then the page's description,
 * API notes and data warnings under 本頁資料範圍, then 資料來源. `children` go before the notes. */
export function ReportMethod({path,description,notes=[],meta,children}:{path:string;description?:string|null;notes?:readonly string[];meta?:ReportMeta;children?:ReactNode}){
 return <PageMethod>
  {blocksFor(path)}
  {children}
  <PageNotes notes={[...(description?[description]:[]),...notes,...metaNotes(meta)]}/>
  <SourceMethod/>
 </PageMethod>;
}
