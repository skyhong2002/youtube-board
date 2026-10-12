import {createHash} from 'node:crypto';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import {MATCH_RULE} from '../../shared/youtube-match-policy.js';
export const TEMPLATE_SAMPLE_SIZE=20,TEMPLATE_MIN_SAMPLE=8,TEMPLATE_MIN_SHARE=0.5;
const MAX_SAMPLE_CHARS=20_000,MAX_SAMPLE_BYTES=80_000,MAX_BATCH_BYTES=16*1024*1024;
export type TextExclusionReason='channel-repeated-line'|'url'|'hashtag-stack'|'social-cta';
export interface TextExclusion {field:'title'|'description';start:number;end:number;reason:TextExclusionReason}
export interface TemplateSample {pk:number;videoId:string;publishedAt:string;description:string}
export interface DescriptionTemplateProfile {
 ruleVersion:typeof MATCH_RULE;channelId:number;sampleSize:20;minimumSample:8;minimumShare:0.5;
 sample:Array<{pk:number;videoId:string;publishedAt:string;descriptionSha256:string}>;
 sampleCount:number;status:'ready'|'insufficient-sample';repeatedLines:Array<{line:string;count:number}>;digest:string;
}
export interface TemplateProfileResult {profile:DescriptionTemplateProfile|null;reason?:'sample-timeout'|'sample-budget-exceeded'|'invalid-sample'}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const lineKey=(line:string)=>line.trim().replace(/\s+/gu,' ');
function lines(text:string){const out:Array<{text:string;start:number;end:number}>=[];const expression=/[^\r\n]+/g;for(const match of text.matchAll(expression))out.push({text:match[0],start:match.index,end:match.index+match[0].length});return out;}
export function buildDescriptionTemplateProfile(channelId:number,input:TemplateSample[]):DescriptionTemplateProfile{
 if(!Number.isSafeInteger(channelId)||channelId<1||input.length>TEMPLATE_SAMPLE_SIZE)throw new Error('Invalid channel template sample');
 const seen=new Set<string>(),sample:DescriptionTemplateProfile['sample']=[],counts=new Map<string,number>();
 for(const row of [...input].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||b.pk-a.pk)){
  if(!Number.isSafeInteger(row.pk)||row.pk<1||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?$/.test(row.publishedAt)||typeof row.description!=='string'||row.description.length>MAX_SAMPLE_CHARS||Buffer.byteLength(row.description)>MAX_SAMPLE_BYTES)throw new Error('Invalid channel template sample');
  const date=new Date(row.publishedAt.slice(0,19).replace(' ','T')+'Z');if(row.publishedAt<'1000-01-01 00:00:00'||!Number.isFinite(+date)||date.toISOString().slice(0,19).replace('T',' ')!==row.publishedAt.slice(0,19))throw new Error('Invalid channel template date');
  if(!/^[A-Za-z0-9_-]{11}$/.test(row.videoId)||seen.has(row.videoId))continue;
  seen.add(row.videoId);sample.push({pk:row.pk,videoId:row.videoId,publishedAt:row.publishedAt,descriptionSha256:hash(row.description)});
  for(const line of new Set(lines(row.description).map(l=>lineKey(l.text)).filter(Boolean)))counts.set(line,(counts.get(line)??0)+1);
 }
 const ready=sample.length>=TEMPLATE_MIN_SAMPLE;
 const repeatedLines=ready?[...counts].filter(([,count])=>count>=sample.length*TEMPLATE_MIN_SHARE).map(([line,count])=>({line,count})).sort((a,b)=>a.line<b.line?-1:a.line>b.line?1:0):[];
 const proof:Omit<DescriptionTemplateProfile,'digest'>={ruleVersion:MATCH_RULE,channelId,sampleSize:TEMPLATE_SAMPLE_SIZE,minimumSample:TEMPLATE_MIN_SAMPLE,minimumShare:TEMPLATE_MIN_SHARE,sample,sampleCount:sample.length,status:ready?'ready':'insufficient-sample',repeatedLines};
 return {...proof,digest:hash(JSON.stringify({...proof,repeatedLines:repeatedLines.map(({line,count})=>({lineSha256:hash(line),count}))}))};
}
export function templateProfileProof(profile:DescriptionTemplateProfile){return {...profile,repeatedLines:profile.repeatedLines.map(({line,count})=>({lineSha256:hash(line),count}))};}
/** Whole promotional lines only, not any sentence discussing a social platform. */
const cta=/^[\s\p{P}\p{S}]*(?:(?:歡迎|立即|請|記得|別忘了|快來|馬上)\s*(?:訂閱|按讚|點讚|追蹤|分享|加入會員|開啟小鈴鐺|開啟通知|購買|下載APP)|(?:訂閱|追蹤)(?:我們|本頻道|頻道|官方|\s*[:：])|(?:按讚|點讚|加入會員|開啟小鈴鐺|開啟通知)(?:\s|[，、!！]|$)|(?:subscribe\s+(?:to|our)|follow\s+(?:us|our)|like\s+(?:us|our)|join\s+(?:us|our)|contact\s+us)\b|(?:合作邀約|業務合作|聯絡我們|官方網站|官方頻道|官方粉專|官方社群|粉絲專頁)\s*[:：]|(?:facebook|instagram|youtube|tiktok|threads|line|fb|ig|臉書)\s*[:：@])/iu;
export function descriptionExclusions(input:{title:string;description:string},profile:DescriptionTemplateProfile):TextExclusion[]{
 const excluded:TextExclusion[]=[],repeated=new Set(profile.repeatedLines.map(r=>r.line));
 for(const field of ['title','description'] as const){
  const text=input[field];
  if(typeof text!=='string'||text.length>100000)throw new Error('Vocabulary matching input exceeds cap');
  if(field==='description')for(const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"「」『』]+/giu))excluded.push({field,start:match.index,end:match.index+match[0].length,reason:'url'});
  if(field==='description')for(const line of lines(text)){
   const clean=lineKey(line.text),reason=repeated.has(clean)?'channel-repeated-line':/^(?:[#＃][\p{L}\p{N}_]+[\s,，、]*){2,}$/u.test(clean)?'hashtag-stack':cta.test(clean)?'social-cta':null;
   if(reason)excluded.push({field,start:line.start,end:line.end,reason});
   else for(const stack of line.text.matchAll(/(?:[#＃][\p{L}\p{N}_]+[\s,，、]*){2,}/gu))excluded.push({field,start:line.start+stack.index,end:line.start+stack.index+stack[0].length,reason:'hashtag-stack'});
  }
 }
 if(excluded.length>10000)throw new Error('Description exclusion budget exceeded');
 return excluded.sort((a,b)=>a.field.localeCompare(b.field)||a.start-b.start||a.end-b.end);
}
/** One bounded request per channel group, never one sample query per target video. */
export async function loadDescriptionTemplateProfiles(db:Connection,channelIds:number[],anchor:string):Promise<Map<number,TemplateProfileResult>>{
 const ids=[...new Set(channelIds)];if(ids.length>500||ids.some(id=>!Number.isSafeInteger(id)||id<1)||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(anchor))throw new Error('Invalid channel template request');
 const profiles=new Map<number,TemplateProfileResult>();let bytes=0;
 for(let offset=0;offset<ids.length;offset+=5){
  const group=ids.slice(offset,offset+5),params=group.flatMap(id=>[id,anchor]);
  const select="(SELECT u_id,pk,videoId,publishedAt,LEFT(description,20001) AS description,OCTET_LENGTH(description) AS description_bytes FROM urt_video WHERE u_id=? AND publishedAt>='1000-01-01 00:00:00' AND publishedAt<=? ORDER BY publishedAt DESC,pk DESC LIMIT 20)";
  let rows:RowDataPacket[];
  try{[rows]=await db.query<RowDataPacket[]>('SET STATEMENT max_statement_time=5 FOR '+group.map(()=>select).join(' UNION ALL '),params);}
  catch(error){if((error as {errno?:number})?.errno!==1969)throw error;for(const id of group)profiles.set(id,{profile:null,reason:'sample-timeout'});continue;}
  if(rows.length>group.length*TEMPLATE_SAMPLE_SIZE)throw new Error('Channel template row budget exceeded');
  for(const row of rows){const id=Number(row.u_id),size=Number(row.description_bytes??0);if(!group.includes(id)||typeof (row.description??'')!=='string')throw new Error('Invalid template response identity');bytes+=Buffer.byteLength(row.description??'');if(!Number.isSafeInteger(size)||size<0||size>MAX_SAMPLE_BYTES)profiles.set(id,{profile:null,reason:'sample-budget-exceeded'});}
  if(bytes>MAX_BATCH_BYTES){for(const id of ids.slice(offset))profiles.set(id,{profile:null,reason:'sample-budget-exceeded'});break;}
  for(const id of group){if(profiles.has(id))continue;try{profiles.set(id,{profile:buildDescriptionTemplateProfile(id,rows.filter(r=>Number(r.u_id)===id).map(r=>({pk:Number(r.pk),videoId:r.videoId,publishedAt:r.publishedAt,description:r.description??''})))});}catch{profiles.set(id,{profile:null,reason:'invalid-sample'});}}
 }
 return profiles;
}
