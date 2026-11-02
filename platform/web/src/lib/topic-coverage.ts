import type {TopicCoverage,TopicRow} from './api';
import {count} from './format';

/** Coverage only counts when the rule ran; `unavailable` or a missing field keeps the old card. */
export function readyCoverage(topic:Pick<TopicRow,'coverage'>):TopicCoverage|null{
 return topic.coverage?.status==='ready'?topic.coverage:null;
}
/** Home card figures, channel count first: one channel posting many clips cannot inflate it. */
export function coverageFigures(topic:Pick<TopicRow,'coverage'|'videoCount'|'grouping'>):{channels:string|null;related:string|null;cited:string}{
 const c=readyCoverage(topic),cited=topic.grouping?`${count(topic.videoCount)} 支引用影片（去重）`:`${count(topic.videoCount)} 筆影片引用`;
 if(!c)return {channels:null,related:null,cited};
 return {channels:`${count(c.channels)} 個頻道在談`,related:c.videos>0?`另有 ${count(c.videos)} 支相關影片`:null,cited:topic.grouping?`引用 ${count(topic.videoCount)} 支（去重）`:`AI 引用 ${count(topic.videoCount)} 筆`};
}
/** Related-video page links keep every other query value. */
export function relatedPage(value:string|string[]|undefined):number{
 const raw=Array.isArray(value)?value[0]:value,page=Number(raw??1);
 return Number.isSafeInteger(page)&&page>=1&&page<=200?page:1;
}
