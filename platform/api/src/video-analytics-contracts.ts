import type {ChannelAvatar} from '../../shared/media-assets.js';
export interface AnalyticsPoint {time:string;value:number|null}
export interface AnalyticsHistory {date:string;views:number|null;likes:number|null;comments:number|null}
export interface AnalyticsComment {id:string;authorId:string|null;authorName:string;text:string;likes:number|null;publishedAt:string|null;reply:boolean}
export interface AnalyticsAuthor {id:string;name:string;comments:number;replies:number;total:number;likes:number|null}
export interface VideoAnalyticsData {
 id:string;title:string;channelId:number|null;channelTitle:string;youtubeChannelId:string;channelAvatar?:ChannelAvatar|null;limit:number;updatedAt:string|null;notes:string[];
 live:{maxCurrent:number|null;hourly:AnalyticsPoint[];daily:AnalyticsPoint[]};
 history:AnalyticsHistory[];
 comments:{status:'missing'|'pending'|'malformed'|'oversized'|'truncated'|'complete';recordedCount:number|null;recordedAuthors:number|null;decodedCount:number|null;decodedAuthors:number|null;latestAt:string|null;hourly:AnalyticsPoint[];daily:AnalyticsPoint[];authors:AnalyticsAuthor[];top:AnalyticsComment[]};
 evidenceCoverage:Record<string,string|number|boolean|null>;
}

/** Compact archive summary. Unavailable decoded counts are null, never a synthetic zero. */
export interface VideoCommentSummary {
 status:VideoAnalyticsData['comments']['status'];
 recordedCount:number|null;recordedAuthors:number|null;decodedCount:number|null;decodedAuthors:number|null;
 latestAt:string|null;updatedAt:string|null;
 evidenceCoverage:VideoAnalyticsData['evidenceCoverage'];
}
