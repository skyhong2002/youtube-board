import { createHash } from 'node:crypto';
export type Period='daily'|'hourly';
export interface Video {videoId:string;title:string;uId:number;channel:string;tags:string[];group:string;views:number|null;publishedAt:string;url:string;position:number}
export interface MediaReport {uId:number;channel:string;event:string;description:string;category:string;angle:string;camp:string;keywords:string[];people:string[];places:string[];videoIds:string[];tags:string[];group:string}
export interface Event {title:string;description:string;category:string;angle:string;camp:string;keywords:string[];people:string[];places:string[];videoIds:string[];videoCount:number;mediaCount:number;position:number;videos:Video[];mediaReports:MediaReport[]}
export interface Context {period:Period;key:string;label:string;url:string;dateFrom:string;dateTo:string;sourceTable:'urt_ai_hour'|'urt_ai_date';sourcePk:string;sourceHash:string;snapshotHash:string;aiRunId:string|null;events:Event[]}
export interface Observation {context_key:string;observed_at:string;video_count:number;media_count:number}
export interface Fingerprint {title:string;title_grams:string[];keywords:string[];people:string[];places:string[];category:string}
export interface Decision {storyId:number;shouldPost:boolean;trigger:string;metricLine:string;burstLine:string;displayVideoIds:string[];previousPostedAt:string|null;deltaVideos:number;deltaMedia:number;batchDuplicate?:boolean;snapshot?:{videoIds:string[];videoChannels:Record<string,string>}}
export interface Brief {headline:string;summary:string;evidence:string[];kind:'extractive'|'generated';model:string|null;requestedModel:string|null;promptHash:string|null;usage:unknown;aiOutcome:'not-requested'|'accepted'|'rejected'|'failed'|'prompt-cap'}
export interface Post {event:Event;decision:Decision;brief:Brief;html:string;previewUrl:string|null;complete:boolean}
export interface Config {dailyMaxPosts:number;hourlyMaxPosts:number;hourlyMinVideos:number;matchHours:number;updateCooldown:number;resurfaceHours:number;updateMinVideos:number;updateMinMedia:number;burstCooldown:number;burstMinVideos:number;burstMinMedia:number;burstMinNewVideos:number;burstHours:number;burstRatio:number;tagLimit:number;dashboard:string;legacyCachePrefix:string;maxEvents:number}
export const groups=['泛綠','泛藍','泛白','泛紅','較無偏','中立','公共電視','公共媒體'];
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const md5=(s:string)=>createHash('md5').update(s).digest('hex');
export const unique=<T>(v:T[])=>[...new Set(v)];
export const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function json(value:unknown):unknown {if(typeof value!=='string'||Buffer.byteLength(value)>16_000_000)throw new Error('notification_source_invalid_json');try{return JSON.parse(value);}catch{throw new Error('notification_source_invalid_json');}}
export const strings=(value:unknown):string[]=>Array.isArray(value)?unique(value.filter((v):v is string=>typeof v==='string'&&!!v.trim()).map(v=>v.trim())):[];
export const text=(value:unknown)=>typeof value==='string'?value.trim():'';
export const taipeiSql=(date:Date)=>new Date(date.getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ');
export const notificationSql=(date:Date)=>date.toISOString().slice(0,19).replace('T',' ');
export const instant=(s:string)=>new Date(s.replace(' ','T')+'Z');
export function config(env:NodeJS.ProcessEnv):Config {
 const n=(key:string,fallback:number,min=1,max=10000)=>{const raw=env[key],value=raw===undefined?fallback:Number(raw);if(!Number.isFinite(value)||value<min||value>max||(!key.endsWith('RATIO')&&!Number.isInteger(value)))throw new Error('Invalid notification limit: '+key);return value;};
 const dashboard=env.TELEGRAM_DASHBOARD_URL??'https://youtube.observe.tw',url=new URL(dashboard);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Invalid notification dashboard URL');
 return {dailyMaxPosts:n('TELEGRAM_DAILY_MAX_POSTS',1,0,1),hourlyMaxPosts:n('TELEGRAM_HOURLY_MAX_POSTS',3,0,3),hourlyMinVideos:n('TELEGRAM_HOURLY_MIN_VIDEOS',8),matchHours:n('TELEGRAM_STORY_MATCH_HOURS',72,1,720),updateCooldown:n('TELEGRAM_UPDATE_COOLDOWN_HOURS',24),resurfaceHours:n('TELEGRAM_RESURFACE_HOURS',72),updateMinVideos:n('TELEGRAM_UPDATE_MIN_VIDEOS',5),updateMinMedia:n('TELEGRAM_UPDATE_MIN_MEDIA',2),burstCooldown:n('TELEGRAM_BURST_COOLDOWN_HOURS',3),burstMinVideos:n('TELEGRAM_BURST_MIN_VIDEOS',8),burstMinMedia:n('TELEGRAM_BURST_MIN_MEDIA',3),burstMinNewVideos:n('TELEGRAM_BURST_MIN_NEW_VIDEOS',4),burstHours:n('TELEGRAM_BURST_BASELINE_HOURS',3,1,23),burstRatio:n('TELEGRAM_BURST_RATIO',2.5,1,100),tagLimit:n('TELEGRAM_CHANNEL_TAG_LIMIT',3,1,8),dashboard:dashboard.replace(/\/$/,''),legacyCachePrefix:env.TS_LARAVEL_CACHE_PREFIX??'',maxEvents:100};
}

/** PHP trim() defaults, matching Laravel notification identity; Unicode whitespace is significant. */
export const legacyEventTitle=(value:unknown)=>typeof value==='string'?value.replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g,''):'';
