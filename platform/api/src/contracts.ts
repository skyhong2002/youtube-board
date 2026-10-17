import type {PoolProvenance,PoolWindows} from './reports/tag-ranked-pool.js';
import type { ChannelAvatar,ChannelSource } from '../../shared/media-assets.js';
import type { ChannelRanking } from '../../shared/channel-ranking.js';
import type { VideoCommentSummary } from './video-analytics-contracts.js';
import type { ReportData } from './report-contracts.js';
/** Public API v1. Timestamps carry their offset; null means unrecorded, never request time. */
export interface ReportMeta {
    schemaVersion: 1;
    requestedAt: string;
    updatedAt: string | null;
    timezone: 'Asia/Taipei';
    source: 'mariadb'|'tag.observe.tw';
    dataset: 'fixture' | 'live' | 'unknown';
    coverage: Record<string, number | string | boolean | null>;
    warnings: string[];
}
export type {KeywordRelationsData} from './reports/keyword-relations.js';
export interface ApiResponse<T> {
    data: T;
    meta: ReportMeta;
}
export interface ApiError {
    error: {
        code: string;
        message: string;
    };
    meta?: ReportMeta;
}
export interface ChannelTag {
    id: number;
    name: string;
    kind: 'channel';
}
export interface ChannelRow {
    /** Same-origin cached branding; never a provider URL. */
    avatar?: ChannelAvatar | null;
    id: number;
    youtubeId: string;
    title: string;
    thumbnail: string | null;
    description: string | null;
    publishedAt: string | null;
    youtubeUrl: string;
    views: number | null;
    subscribers: number | null;
    videoCount: number | null;
    weeklyViews: number | null;
    monthlyViews: number | null;
    weeklySubscribers: number | null;
    weeklyVideos: number | null;
    monthlySubscribers: number | null;
    monthlyVideos: number | null;
    estimatedWeeklyViews: number | null;
    estimatedMonthlyViews: number | null;
    monthlyEstimateGap: number | null;
    legacyGrowthPercent: number | null;
    averageWeeklyViewsPerVideo: number | null;
    updatedAt: string | null;
    tags: ChannelTag[];
}
export interface VideoRow {
    keywordEvidence?: {term:string;field:'title'|'description'|'caption';snippet:string;start:number;end:number;snippetStart:number}[];
    channelAvatar?: ChannelAvatar | null;
    listing?: {scope:'channel'|'taxonomy'|'general'|'keyword';providerComments:number|null;recordedComments:number|null;commentStatus:'complete'|'pending'|'missing'|null;commentAuthors:number|null;commentReplies:number|null;commentLikes:number|null;likeSharePercent:number|null;commentsPerThousandViews:number|null;commentObservedAt:string|null;tags:ChannelTag[]};
    id: string;
    channelId: number;
    youtubeChannelId: string;
    channelTitle: string;
    title: string;
    description: string;
    thumbnail: string | null;
    publishedAt: string | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    updatedAt: string | null;
    youtubeUrl: string;
}
export interface LiveRow extends VideoRow {
    partialLogEvidence?: boolean;
    currentViewers: number;
    todayPeak: number;
    allTimePeak: number | null;
    startedAt: string | null;
    trend: {
        time: string;
        value: number;
    }[];
    tags: ChannelTag[];
}
export interface VideoCollection extends Omit<Collection<VideoRow>,'total'> {
    /** Present only for publishedAt ordering. Resume with identical filters and offset 0. */
    nextCursor?: string | null;
    total: number | null;
    hasNext: boolean;
    totalStatus: 'exact' | 'not-computed' | 'unavailable';
}
export interface Collection<T> {
    evidenceCoverage?: ReportMeta['coverage'];
    rows: T[];
    total: number;
    limit: number;
    offset: number;
}
export interface ChannelCollection extends Collection<ChannelRow> {
    ranking: ChannelRanking;
}
export interface TagRow extends ChannelTag {
    channels: number;
    weeklyViews: number;
    average: number;
    median: number;
}
export interface KeywordRow {
    tag: string;
    hoursCount: number;
    maxCount: number;
    maxHours: string | null;
    weight: number;
    origin: 'legacy-keyword-cache';
}
export interface EventEvidence {
    channelAvatar?: ChannelAvatar | null;
    channelId: number;
    channelTitle: string;
    event: string;
    videoIds: string[];
    resolvedVideoIds?: string[];
    withheldVideoReferenceCount?: number;
    invalidReferenceCount?: number;
    keywords: string[];
    people: string[];
    source: {
        table: 'urt_channel_ai';
        id: number;
        itemIndex?: number;
        snapshotRunId?: string;
    };
}
/** Counts behind the Laravel /ai/days summary box; video counts sum the cited references. */
export interface TopicSummary {
    keywords: { term: string; count: number }[];
    people: { term: string; count: number }[];
    party: { green: number; blue: number };
    angle: { taiwan: number; china: number };
    camp: { dpp: number; kmt: number };
    videos: { videoId: string; channelId: number; channelTitle: string; event: string }[];
}
export interface TopicRow {
    grouping?: 'source-signals';
    detailUrl?: string;
    id: string;
    dailyId: number;
    title: string;
    channelCount: number;
    videoCount: number;
    score: number;
    keywords: string[];
    people: string[];
    evidence: EventEvidence[];
    unresolvedReferences: {
        channelTitle: string;
        event: string;
    }[];
    summary?: TopicSummary;
}
export interface AiDaysData {
    date: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    dailyId: number | null;
    dataType?: string | null;
    condition: string;
    rows: TopicRow[];
    channels: number;
    source: 'daily-cache' | 'channel-summaries' | 'none';
    evidenceCoverage?: ReportMeta['coverage'];
    updatedAt: string | null;
    rawVideoRows: number | null;
    sourceChannels: number;
    sourceStats?: { channels: number; channelsWithEvents: number; eventRows: number; videoRefs: number };
    lineage?: { state:'immutable-snapshot'|'snapshot-unavailable';runId:string|null };
}
export interface EventCitation {
    id:string|null;rawId:string;media:string;href:string|null;sourceChannel?:ChannelSource;
    verification:'snapshot'|'stored-reference'|'missing'|'invalid'|'outside-snapshot';
}
export interface EventAnalysis {
    id:number;type:string;result:unknown;updatedAt:string|null;
    lineage?:{state:'immutable-snapshot'|'legacy-unrecorded';runId:string|null;dailyResultSha256:string|null;sourceChanged:boolean;sourceVideos:{id:string;title:string;channelId:number;media:string}[]};
}
export interface EventPresentation {
    summaries:{analysisId:number;title:string;description:string;keywords:string[];media:string[];sourceChannels?:ChannelSource[];facts:{headline:string;citation:EventCitation}[];opinions:{stance:string;intensity:string;content:string;citation:EventCitation}[]}[];
    people:{analysisId:number;mainSubject:string;groups:{kind:'supporting'|'opposing'|'other';rows:{person:string;role:string;stance:string;strength:string;description:string;citations:EventCitation[]}[]}[]} | null;
    media:{analysisId:number;mainSubject:string;all:string[];sourceChannels?:ChannelSource[];groups:{kind:'supporting'|'opposing'|'other';rows:{media:string;sourceChannel?:ChannelSource;stance:string;strength:string;description:string}[]}[]} | null;
}
export interface AiEventData {
    id:number;dailyId:number;title:string;date:string|null;topic:TopicRow|null;topics:TopicRow[];idKind:'daily'|'event';
    analyses:EventAnalysis[];videos:VideoRow[];
    resolution:{requestedTitle:string;canonicalTitle:string;kind:'exact'|'same-day-source-alias';sourceDailyId:number;topicIds:string[]};
    presentation:EventPresentation;
    evidenceCoverage:ReportMeta['coverage'];
}
/** Additive /ai/events/:id/people fields: Laravel event-people's header (event, date, daily id)
 * and its people/media blocks (main subject, AI-category groups, listed media) as stored. */
export interface AiEventPeopleFields { event:string;date:string|null;dailyId:number;people:EventPresentation['people'];media:EventPresentation['media'] }
export interface AiEventWallVideo { videoId:string;label:string;media:string;kind:'fact'|'opinion'|'supporting'|'opposing'|'other'|'source';title:string|null;source:ChannelSource|null }
/** /ai/events/:id/wall. title..evidenceCoverage keep the live-wall shape; the rest is additive:
 * citedVideos is Laravel's wall, sourceVideos the uncited local source videos (newest first, at most 48). */
export interface AiEventWallData {
    title:string;tabs:{label:string;type:number}[];streams:{id:string;label:string;slot:number}[];total:number;updatedAt:string|null;notes:string[];variant:'event';evidenceCoverage:ReportMeta['coverage'];
    event:string;date:string|null;dailyId:number;resolution:AiEventData['resolution'];citedVideos:AiEventWallVideo[];sourceVideos:AiEventWallVideo[];sourceVideosTotal:number;
}
/** Fresh YouTube title/description evidence, ranked by video count; at most 40 cloud terms. */
export type HomeKeywordSummary = {
 rankingPool?:{status:'available';provenance:PoolProvenance;comparisonBasis:'current-eligible-terms'}|{status:'unavailable';reason:string;windows:PoolWindows};
 sourceQuality?:VocabularySourceQuality; vocabularyCoverage:'observed-article-window'|'all-current-indexed-article-tags'|'unavailable';vocabularyWindow:{since:string;until:string}|null;source:'https://tag.observe.tw';version:string|null;status:'synchronized'|'not-synchronized'|'unavailable';reason:string|null;from:string;to:string;updatedAt:string|null;
 rows:{key:string;term:string;sourceTerms:{key:string;term:string}[];videoCount:number;views:number|null;unknownViewVideos:number;knownViews:number;measuredViewVideos:number;heatScore:number;channelCount:number;titleVideos:number;descriptionOnlyVideos:number;rise:number|null;trend:{date:string;heat:number|null}[];representativeVideoId:string|null;thumbnail:string|null;channel:{id:number;name:string;title:string;youtubeId:string;youtubeUrl:string;thumbnail:string|null;avatar:ChannelAvatar|null}|null}[];
 sourceVideos:number|null;freshVideos:number|null;staleVideos:number|null;unprocessedVideos:number|null;metric:'current-cumulative-views-of-window-published-videos';
 rankingMethod:'youtube-channel-weighted-decay-v1';riseMethod:'equal-duration-heat-delta';ruleVersion:'exact-text-v1'|'youtube-quality-v2';
 /** complete: both windows reach minCoverage matched share (not literal 100%). */
 comparison:{from:string;to:string;complete:boolean;minCoverage?:number;sourceVideos:number|null;freshVideos:number|null;staleVideos:number|null;unprocessedVideos:number|null}|null;
 exclusions:{scope:'fresh-window-matched-terms';terms:number;reasons:Record<string,number>;policyCommit:string;youtubePolicyVersion:string}|null;
};
export interface HomeExploration {
    categories: { status:'available'|'unavailable';reason:string|null;rows:TagRow[];summary:{visibleCategories:number|null;channelMemberships:number|null;uniqueChannels:number|null;weeklyViews:number|null;overlapping:true};updatedAt:string|null;minimumWeeklyViews:10 };
    /** Seven inclusive Taipei calendar dates through response to. */
    keywords: HomeKeywordSummary;
    /** Current Taipei date from midnight through response to. */
    keywordToday: HomeKeywordSummary;
}
export interface HomeData {
    exploration: HomeExploration;
    summary: {
        channels: number;
        videos: number;
        weeklyViews: number;
        liveChannels: number;
        liveViewers: number;
    };
    channels: ChannelRow[];
    tags: TagRow[];
    tagsStatus?: 'available' | 'bounded';
    live: LiveRow[];
    events: TopicRow[];
    aiDate: string | null;
}
export interface ChannelData {
    aiSummary: ReportData;
    dailySummary: ReportData;
    trendAvailable: boolean;
    channel: ChannelRow;
    videos: VideoRow[];
}
export interface VideoData {
    video: VideoRow;
    commentSummary: VideoCommentSummary;
    durationSeconds: number | null;
    captionAvailable: boolean | null;
    history: {
        date: string;
        views: number | null;
        likes: number | null;
        comments: number | null;
        measured: true;
    }[];
    liveHistory: {
        time: string;
        viewers: number;
        measured: true;
    }[];
}
export interface VocabularyTerm {
    displayExclusion?: string | null;
    rankingEligibility?:{today:string|null;week:string|null};
    key: string;
    term: string;
    articleCount: number;
    media: string[];
    provenance: 'upstream-article-tag-origin-unspecified';
}
export interface VocabularySourceQuality { normalizedTags: number; rejectedTags: number; articlesWithRejectedTags: number }
export interface VocabularyData extends Collection<VocabularyTerm> {
    version: string | null;
    source: 'https://tag.observe.tw';
    attribution: string;
    window: {
        since: string;
        until: string;
    } | null;
    publishedAt: string | null;
    coverage: 'observed-article-window' | 'all-current-indexed-article-tags';
    upstreamSnapshotConsistent: boolean;
    sourceQuality?: VocabularySourceQuality;
}
export interface VideoTagEvidenceData {
    videoId: string;
    version: string | null;
    status: 'not-synchronized' | 'not-matched' | 'matched' | 'stale';
    matchedAt: string | null;
    source: 'https://tag.observe.tw';
    rows: {
        key: string;
        term: string;
        field: string;
        start: number;
        end: number;
        text: string;
        snippet: string;
        snippetStart: number;
        ruleVersion: string;
    }[];
}
