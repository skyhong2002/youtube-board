import type { ChannelAvatar,ChannelSource } from '../../shared/media-assets.js';
export type ReportValue = string | number | boolean | null;
export interface ReportCell {
    sources?: ChannelSource[];
    media?: { kind: 'channel'; channelId: number; avatar: ChannelAvatar | null } | { kind: 'video'; videoId: string; thumbnail: string | null };
    value: ReportValue;
    href?: string;
    detail?: string;
}
export interface ReportColumn {
    key: string;
    label: string;
    kind?: 'text' | 'number' | 'date' | 'datetime' | 'percent';
    unit?: string;
}
export interface ReportSeries {
    name: string;
    unit: string;
    points: {
        time: string;
        value: number | null;
    }[];
}
export interface ReportData {
    title: string;
    navigation?: {label:string;href:string;active?:boolean}[];
    /** Extra rows of switch tabs (period, metric, group) drawn under the title, each with an accessible label. */
    tabRows?: {label:string;items:{label:string;href:string;active?:boolean}[]}[];
    description?: string;
    columns: ReportColumn[];
    rows: Record<string, ReportValue | ReportCell>[];
    total: number;
    limit: number;
    offset: number;
    sections?: {
        key?: string;
        title: string;
        columns: ReportColumn[];
        rows: Record<string, ReportValue | ReportCell>[];
    }[];
    series?: ReportSeries[];
    metrics?: {
        label: string;
        value: number | null;
        unit?: string;
        detail?: string;
    }[];
    words?: {
        term: string;
        weight: number;
        href?: string;
    }[];
    notes?: string[];
    filters?: {
        key: string;
        label: string;
        type: 'date' | 'number' | 'text' | 'select';
        value: string;
        options?: {
            value: string;
            label: string;
        }[];
    }[];
    updatedAt?: string | null;
    /** Per-date bucket coverage for every charted date; unlike rows it is never paginated. */
    bucketCoverage?: {
        date: string;
        observedBuckets: number;
    }[];
}
/** /ai/aspects additions (Laravel AiAspectReport): a tag is LegacyTagFilter's {id, name}. */
export interface AspectTag {id:number;name:string}
export interface AspectReportData extends ReportData {
    /** Keyed by local channel ID, for the channels in rows only: their visible tags (1,2,3,4,5,6,60,43,48,49,81) in the channel's own tag order. */
    channelTags: Record<string, AspectTag[]>;
    /** The effective tagid, or and not IDs (after condition), each once, with names. */
    filterTags: AspectTag[];
}
