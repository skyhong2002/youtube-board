import type {HomeData,TopicRow} from './api';

const VIDEO_ID=/^[\w-]{11}$/;
/** Home focus picture: a reference confirmed against current local videos first, then the
 * summary's representative video (the one /ai/days embeds; immutable TS snapshots skip local
 * resolution, so this is their only picture), then a cited video that is live right now. */
export function topicVideoId(topic:TopicRow,data:Pick<HomeData,'live'>):string|null{
 const resolved=topic.evidence.flatMap(e=>e.resolvedVideoIds??[]).find(id=>VIDEO_ID.test(id));if(resolved)return resolved;
 const representative=topic.summary?.videos.map(v=>v.videoId).find(id=>VIDEO_ID.test(id));if(representative)return representative;
 const ids=new Set(topic.evidence.flatMap(e=>e.videoIds));return data.live.find(v=>ids.has(v.id))?.id??null;
}
