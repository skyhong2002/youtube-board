import type { ChannelAvatar } from '../../shared/media-assets.js';
export type ReportValue = string | number | boolean | null;
export interface ReportCell {
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
}
