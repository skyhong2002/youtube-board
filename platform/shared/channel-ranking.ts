/** Column names are legacy cache fields; labels distinguish estimates from observations. */
export const CHANNEL_SORTS = [
 ['viewCount','累計觀看'],['subscriberCount','訂閱人數'],['videoCount','累計影片'],
 ['view_week','近七日觀看增量'],['view_month','近月觀看增量'],
 ['views_pred_week','近七日觀看估計'],['views_pred_month','近月觀看估計'],
 ['sub_week','近七日訂閱增量'],['sub_month','近月訂閱增量'],
 ['video_week','近七日影片增量'],['video_month','近月影片增量'],
] as const;
export type ChannelSort = typeof CHANNEL_SORTS[number][0];
export type ChannelRankingScope = 'directory' | 'tag';
export interface ChannelRanking {
 column:ChannelSort;scope:ChannelRankingScope;min:number|null;minMetric:'views'|'subscribers';
}
