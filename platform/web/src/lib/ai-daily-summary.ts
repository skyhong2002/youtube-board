import type {TopicRow} from "../../../api/src/contracts";

/** One event row from the existing /channels/:id/ai/days report. */
export interface ChannelAiEvent { title: string; angle: string; camp: string; videos: number }
export interface TopicSummary {
    keywords: { term: string; count: number }[];
    people: { term: string; count: number }[];
    party: { green: number; blue: number };
    angle: { taiwan: number; china: number };
    camp: { dpp: number; kmt: number };
    videos: { videoId: string; channelTitle: string; event: string }[];
}
export interface SourceStats { channelsWithEvents: number; eventRows: number; videoRefs: number }
/** 24-hour news streams the Laravel page never used as representative videos. */
const NO_REPRESENTATIVE = new Set([406, 456]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
function top(counts: Map<string, number>) {
    return [...counts].map(([term, count]) => ({term, count})).sort((a, b) => b.count - a.count).slice(0, 5);
}
/** The Laravel /ai/days summary box, rebuilt from data the existing API already returns:
 * evidence on the topic, channel AI rows for angle/camp, and the 泛綠 [4] / 泛藍 [3] tag lists. */
export function topicSummary(topic: TopicRow, events: Map<number, ChannelAiEvent[]>, green: Set<number>, blue: Set<number>): TopicSummary {
    const keywords = new Map<string, number>(), people = new Map<string, number>();
    const summary: TopicSummary = {keywords: [], people: [], party: {green: 0, blue: 0}, angle: {taiwan: 0, china: 0}, camp: {dpp: 0, kmt: 0}, videos: []};
    for (const e of topic.evidence) {
        const videos = e.videoIds.length || e.withheldVideoReferenceCount || 0;
        for (const k of e.keywords) keywords.set(k, (keywords.get(k) ?? 0) + 1);
        for (const p of e.people) people.set(p, (people.get(p) ?? 0) + 1);
        const match = events.get(e.channelId)?.find(row => row.title === e.event);
        if (match) {
            if (match.angle.includes("台灣")) summary.angle.taiwan += videos;
            if (match.angle.includes("中國")) summary.angle.china += videos;
            if (match.camp.includes("民進黨")) summary.camp.dpp += videos;
            if (match.camp.includes("國民黨")) summary.camp.kmt += videos;
        }
        if (green.has(e.channelId)) summary.party.green += videos;
        if (blue.has(e.channelId)) summary.party.blue += videos;
        const first = e.videoIds[0];
        if (first && VIDEO_ID.test(first) && !NO_REPRESENTATIVE.has(e.channelId) && summary.videos.length < 3)
            summary.videos.push({videoId: first, channelTitle: e.channelTitle, event: e.event});
    }
    summary.keywords = top(keywords);
    summary.people = top(people);
    return summary;
}
/** Laravel's "AI source" card: with condition=all, events citing at most one video are not counted. */
export function sourceStats(events: Map<number, ChannelAiEvent[]>, condition: string): SourceStats {
    const stats = {channelsWithEvents: 0, eventRows: 0, videoRefs: 0};
    for (const rows of events.values()) {
        const counted = rows.filter(row => row.title && (condition !== "all" || row.videos > 1));
        if (counted.length) stats.channelsWithEvents++;
        stats.eventRows += counted.length;
        stats.videoRefs += counted.reduce((n, row) => n + row.videos, 0);
    }
    return stats;
}
