import {eventTabs,familyTabs,wallVariantTabs} from '@/lib/report-navigation';
import { api, rejectMalformedPayload, type Search } from '@/lib/api';
import { Heading, DataNotice, Unavailable, Tabs } from './ReportUI';
interface Wall { title:string; notes:string[]; tabs:{label:string;type:number}[]; streams:{id:string;label:string;slot:number}[] }
export async function LiveWall({apiPath,search,path}:{apiPath:string;search:Search;path:string}) {
    const result=await api<Wall>(apiPath,search);
    if(!result.ok)return <Unavailable status={result.status} title="四窗直播"/>;
    const {data,meta}=result.response;
    if(!Array.isArray(data.streams)||data.streams.some(s=>!/^[-_A-Za-z0-9]{11}$/.test(s.id))){rejectMalformedPayload();return <Unavailable status={502} title="四窗直播"/>;}
    return <><Heading title={data.title} meta={meta}/><DataNotice meta={meta}/>{!eventTabs(path,search).length&&<Tabs items={familyTabs(path,search)} active={path}/>}<Tabs items={eventTabs(path,search).length?eventTabs(path,search):wallVariantTabs()} active={path}/><Tabs items={data.tabs.map(t=>({label:t.label,href:`${path}?type=${t.type}`}))} active={`${path}?type=${String(search.type||1)}`}/><aside className="notice">{data.notes.join(' ')}</aside><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,380px),1fr))',gap:16}}>{data.streams.map(s=><section key={s.slot}><h2>{s.label}</h2><iframe title={s.label} src={`https://www.youtube-nocookie.com/embed/${s.id}?autoplay=0`} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" style={{width:'100%',aspectRatio:'16/9',border:0}}/><a href={`https://www.youtube.com/watch?v=${s.id}`} target="_blank" rel="noopener noreferrer">在 YouTube 開啟</a></section>)}</div></>;
}
