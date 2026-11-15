export interface YoutubeContentPreview {videoId:string;title:string;channelId:string;channelTitle:string;broadcast:'live'|'upcoming'|'ended'|'video'|'unknown'}
/** Administrator lookup reads source ingestion records, independently of public display cache refreshes. */
export type ContentKind = 'video' | 'live' | 'channel';
export interface ContentMatch { kind: ContentKind; id: string; title: string; channelId: number; href: string; retired?: boolean; youtubeChannelId?: string }
export interface ContentLookup {
  youtube?: YoutubeContentPreview | null;
  source: string | null;
  videoId: string | null;
  channel: { channelId: number; youtubeChannelId: string; title: string; tags: number[]; archived: boolean } | null;
  video: { videoId: string; title: string; channelId: number; collectedAt: string | null } | null;
  live: { videoId: string; title: string; channelId: number; retired: boolean } | null;
  matches: ContentMatch[];
  generatedAt: string;
}
