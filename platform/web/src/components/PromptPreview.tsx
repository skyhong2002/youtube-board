import {familyTabs} from '@/lib/report-navigation';
import {api,type Search} from '@/lib/api';
import {Heading,DataNotice,Unavailable,Tabs} from './ReportUI';
interface Preview {title:string;promptVersion:string;prompt:string;schema:unknown;sourceCount:number;sourceLimit:number;omitted:number;blocked:string|null;notes:string[]}
export async function PromptPreview({apiPath,search,path}:{apiPath:string;search:Search;path:string}){
 const result=await api<Preview>(apiPath,search);if(!result.ok)return <Unavailable status={result.status} title="提示詞預覽"/>;
 const {data,meta}=result.response;
 return <><Heading title={data.title} meta={meta}/><DataNotice meta={meta}/><Tabs items={familyTabs(path,search,meta.coverage)} active={path}/><aside className="notice">{data.notes.map((s,i)=><p key={i}>{s}</p>)}</aside><p>提示詞版本：{data.promptVersion} · 來源筆數：{data.sourceCount} · 來源上限：{data.sourceLimit} · 未納入：{data.omitted}</p>{data.blocked&&<p className="notice">這份來源目前不能執行生成：{data.blocked}</p>}<h2>提示詞</h2><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{data.prompt}</pre><details><summary>輸出資料格式</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(data.schema,null,2)}</pre></details></>;
}
