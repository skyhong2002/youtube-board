import { dailyTopicTitle } from '../../../shared/daily-topic-title.js';
import type { TopicRow, EventEvidence } from '../contracts.js';
import type { Row } from '../db/client.js';
import { aiItems, integer, list, object, pickStrings, pickText } from './normalize.js';
const titleKeys = ['事件', '議題', '標題', 'event', 'topic', 'title'];
/** Preserve exact legacy references and all video evidence. No fuzzy title merging or inferred causal claims. */
export function buildTopics(dailyId: number, raw: unknown, channelMap: Map<number, string>, aiByChannel: Map<number, Row>): TopicRow[] {
    const byName = new Map<string, number[]>();
    for (const [id, name] of channelMap)
        byName.set(name, [...(byName.get(name) ?? []), id]);
    const indexedSources=new Map<number,Map<string,Row|null>>(),normalized=new Map<Row,{videoIds:string[];keywords:string[];people:string[]}>();
    for(const [id,source]of aiByChannel){const events=new Map<string,Row|null>();for(const e of aiItems(source.result_json).map(object)){const name=pickText(e,titleKeys);events.set(name,events.has(name)?null:e);}indexedSources.set(id,events);}
    return aiItems(raw).map((item, index) => {
        const t = object(item), title = dailyTopicTitle(t), media = object(t['媒體事件'] ?? t.media_events ?? t.mediaEvents);
        const evidence: EventEvidence[] = [], unresolvedReferences: {
            channelTitle: string;
            event: string;
        }[] = [], seen = new Set<string>();
        for (const [channelTitle, events] of Object.entries(media))
            for (const event of Array.isArray(events) ? events : []) {
                if (typeof event !== 'string' || !event.trim())
                    continue;
                const name = event.trim(), key = channelTitle + '\u0000' + name;
                if (seen.has(key))
                    continue;
                seen.add(key);
                const candidates = byName.get(channelTitle) ?? [];
                // Duplicate channel names cannot establish identity; surface the unresolved reference.
                const id = candidates.length === 1 ? candidates[0] : undefined, source = id === undefined ? undefined : aiByChannel.get(id);
                const match=id===undefined?undefined:indexedSources.get(id)?.get(name);
                if (id === undefined || !source || !match) {
                    unresolvedReferences.push({ channelTitle, event: name });
                    continue;
                }
                let fields=normalized.get(match);if(!fields){fields={videoIds:pickStrings(match,['videoId','video_id','video_ids','videos']),keywords:pickStrings(match,['關鍵字','keywords']),people:pickStrings(match,['人物','people']).filter(v=>v!=='無')};normalized.set(match,fields);}
                evidence.push({ channelId: id, channelTitle, event: name, ...fields, source: { table: 'urt_channel_ai', id: integer(source.pk) ?? 0, ...(typeof source.snapshot_run_id==='string'?{snapshotRunId:source.snapshot_run_id}:{}) } });
            }
        const channelCount = Object.values(media).filter(v => Array.isArray(v) && v.some(e => typeof e === 'string' && e.trim() !== '')).length, videoCount = evidence.reduce((n, e) => n + e.videoIds.length, 0);
        return { id: `${dailyId}:${index}`, dailyId, title, channelCount, videoCount, score: videoCount + channelCount * 3, keywords: [...new Set(evidence.flatMap(e => e.keywords))], people: [...new Set(evidence.flatMap(e => e.people))], evidence, unresolvedReferences };
    }).filter(t => t.title).sort((a, b) => b.score - a.score);
}
