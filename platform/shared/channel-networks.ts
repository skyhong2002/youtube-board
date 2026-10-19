/** Media-group channel tags on urt_count.tags. One network owns many YouTube channels
 * (旺中 runs 中天新聞, 中天電視, 中時新聞網, 中視新聞, …), so cross-media confirmation
 * counts networks, not channels. Order is precedence: a channel tagged both 旺中 and
 * 中視 belongs to 旺中. MCN tags (VS Media, STR Network) group creators, not newsrooms,
 * and are deliberately absent. Tags 109–114 were added on 2026-10-19 with urt_tag_log rows. */
export const NETWORK_TAGS: readonly (readonly [number, string])[] = [
  [53, '旺中'], [29, 'TVBS'], [50, '民視'], [63, '東森'], [64, '三立'], [65, '台視'], [66, 'ETtoday'],
  [19, '公共電視'], [69, '華視'], [70, '自由時報'], [72, '八大'], [73, '龍華環宇'], [75, '中廣飛碟'],
  [76, '非凡'], [77, '鏡傳媒'], [78, 'NOWnews'], [80, '年代'], [84, '緯來'], [85, 'UDN'], [96, '中視'],
  [98, '中時'], [97, '燦鋒傳媒'], [104, '愛爾達'], [18, '關鍵評論網'], [55, '大紀元'], [67, '麥卡貝'],
  [109, '中央社'], [110, '大愛'], [111, '原文會'], [112, '中嘉'], [113, '凱擘'], [114, '上報'],
];
export interface ChannelNetwork { key: string; name: string }
/** A channel without a network tag stands alone, keyed by its channel id. */
export function channelNetwork(channelId: number, tagIds: readonly number[], channelTitle: string): ChannelNetwork {
  for (const [id, name] of NETWORK_TAGS) if (tagIds.includes(id)) return { key: `tag:${id}`, name };
  return { key: `channel:${channelId}`, name: channelTitle };
}
