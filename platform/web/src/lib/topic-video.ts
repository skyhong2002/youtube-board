import type {HomeData,TopicRow} from './api';

const VIDEO_ID=/^[\w-]{11}$/;
/** Most pictures a focus card tries before showing the placeholder. */
export const TOPIC_VIDEO_CANDIDATES=6;
/** Home focus picture candidates, best first: references confirmed against current local videos,
 * then the summary's representative videos (the ones /ai/days embeds; immutable TS snapshots skip
 * local resolution, so these are their only pictures), with the two most viewed rule-matched related videos
 * of other channels (topic coverage) after the first three, then cited videos that are live right now.
 * Later entries are fallbacks for when an earlier video was made private or deleted on YouTube
 * after the analysis ran (its thumbnail then 404s). */
export function topicVideoIds(topic:TopicRow,data:Pick<HomeData,'live'>):string[]{
 const cited=new Set(topic.evidence.flatMap(e=>e.videoIds));
 const ai=[...new Set([...topic.evidence.flatMap(e=>e.resolvedVideoIds??[]),...(topic.summary?.videos.map(v=>v.videoId)??[])].filter(id=>VIDEO_ID.test(id)))];
 const related=topic.coverage?.status==='ready'?topic.coverage.top.map(v=>v.videoId):[];
 // Long AI lists must not crowd out the related videos: three AI pictures, two related, then the rest.
 const ordered=[...ai.slice(0,3),...related.slice(0,2),...ai.slice(3),...related.slice(2),...data.live.filter(v=>cited.has(v.id)).map(v=>v.id)];
 return [...new Set(ordered.filter(id=>VIDEO_ID.test(id)))].slice(0,TOPIC_VIDEO_CANDIDATES);
}
export function topicVideoId(topic:TopicRow,data:Pick<HomeData,'live'>):string|null{
 return topicVideoIds(topic,data)[0]??null;
}
