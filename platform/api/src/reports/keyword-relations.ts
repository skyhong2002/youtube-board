import {tagHttpOptions} from '../../../jobs/src/tag-http.js';
import {BadQuery} from './query.js';
import {createTagRelationsClient,type TagRelation,type RelationFallbackReason} from './tag-relations-client.js';

export interface KeywordRelationsData {
 keyword:string;
 source:'https://tag.observe.tw';
 sourceUrl:string;
 status:'available'|'disabled'|'unavailable';
 reason:RelationFallbackReason|'configuration'|null;
 tagId:string|null;
 truncated:boolean;
 relations:TagRelation[];
 retryAfterSeconds:number|null;
}
export interface KeywordRelationsOptions {
 env?:NodeJS.ProcessEnv;
 fetcher?:typeof fetch;
 clock?:()=>Date;
 /** Constructor injection for offline tests only, never supplied by a request. */
 credentials?:()=>Promise<{serviceToken?:string}>;
}
export function createKeywordRelationsReport(options:KeywordRelationsOptions={}) {
 const env=options.env??process.env,enabled=env.TS_TAG_RELATIONS_ENABLED==='true';
 const source='https://tag.observe.tw' as const;
 const initialize=async()=>{
  const credentials=await (options.credentials??(()=>tagHttpOptions(env)))();
  // This service uses its assigned quota. Missing/invalid configuration must not
  // silently switch all public page traffic to the anonymous quota.
  if(!credentials.serviceToken)throw new Error('Relations configuration unavailable');
  return createTagRelationsClient({enabled:true,serviceToken:credentials.serviceToken,fetch:options.fetcher,clock:options.clock,fallback:async()=>null});
 };
 let client:ReturnType<typeof initialize>|undefined;
 return async(keyword:string):Promise<KeywordRelationsData>=>{
  if(typeof keyword!=='string'||!keyword.length||[...keyword].length>60||keyword!==keyword.trim()||/[\p{Cc}\p{Cs}]/u.test(keyword))throw new BadQuery('Keyword must be 1–60 Unicode characters without surrounding whitespace or controls.');
  const base={keyword,source,sourceUrl:source+'/tag/'+encodeURIComponent(keyword)+'/',tagId:null,truncated:false,relations:[],retryAfterSeconds:null};
  if(!enabled)return {...base,status:'disabled',reason:'disabled'};
  let read:Awaited<ReturnType<typeof initialize>>;
  try{read=await (client??=initialize());}catch{return {...base,status:'unavailable',reason:'configuration'};}
  const result=await read(keyword);
  if(result.status==='fallback')return {...base,status:'unavailable',reason:result.reason,retryAfterSeconds:result.retryAfterSeconds};
  return {...base,status:'available',reason:null,tagId:result.data.tagId,truncated:result.data.truncated,relations:result.data.relations};
 };
}
