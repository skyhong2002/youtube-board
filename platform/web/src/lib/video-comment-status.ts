import type {VideoAnalyticsData} from '../../../api/src/video-analytics-contracts';
export const videoCommentStatuses:Record<VideoAnalyticsData['comments']['status'],string>={missing:'尚無留言批次',pending:'擷取中，尚未公開',malformed:'來源格式無法解析',oversized:'來源超過解析上限',truncated:'僅解析部分來源',complete:'已完成擷取'};
