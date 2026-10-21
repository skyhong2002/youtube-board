import {sql} from 'drizzle-orm';
import type {Reader} from '../db/client.js';
import {ReportReadBound} from './cache-weights.js';
// Repository-owned Laravel display exclusions (same words as the legacy urtube/stopwords.php); not a vocabulary membership list.
export const LEGACY_DISPLAY_STOPWORDS=["會員", "YouTube", "加入", "節目", "時間", "小編", "報告", "分享", "管理員", "留言", "斗內", "下載", "平台", "主持", "訊息", "粉專", "群組", "爆料", "討論", "同意", "頻道", "立場", "聊天室", "2020年", "Pay", "ATM", "直播", "帳號", "10月", "11月", "12月", "7月", "1月", "3月", "24小時", "主持人", "線上", "線上直播", "Clubhouse", "粉絲團", "Podcast", "商品", "折扣", "2021年", "2022年", "2023年", "歷史", "國際", "全台", "社會", "焦點", "世界", "禁止", "測試", "影片", "規範", "網站", "官網", "電視", "新聞", "資訊", "發言", "科技", "即時新聞", "全球", "晚報", "日常", "Taiwan", "TVBS", "中天電視", "中天新聞", "少康戰情室", "關鍵時刻", "民視新聞台", "新台灣加油", "新聞面對面", "中天", "三立", "三立新聞", "東森", "民視", "中視", "台視", "新唐", "壹電視", "新聞台", "電視台", "年代", "K2", "不演了新聞台", "鄭知道了", "辣新聞", "辣新聞152", "Android", "APP", "iOS", "Spotify", "KKBOX", "LINE", "Facebook", "Instagram", "Twitch", "Telegram", "WeChat", "WhatsApp", "Gary", "UCC", "MER", "CIA", "精神", "呼籲", "支援", "力量", "自然", "S21", "T1", "F1", "董事長", "董事長開講", "羅斯", "IVE"];
// Site additions (2026-10-21): the subscribe / social-media boilerplate channels paste under every video.
export const SITE_DISPLAY_STOPWORDS=["訂閱", "IG", "FB", "Threads", "Live"];
export interface Stopwords {has(term:string):boolean}
const fold=(term:string)=>term.trim().replace(/[A-Z]/g,c=>c.toLowerCase());
// Years (2026, 2026年) and one- or two-digit counts and dates (20, 10月, 3日); longer numbers such as 228 or 1450 stay.
const calendarNumber=/^(?:(?:19|20)\d{2}年?|\d{1,2}(?:年|月|日|號)?)$/;
/** Exclusions match ASCII letters case-insensitively (LINE, Line and line alike) and drop calendar numbers. */
export function stopwordSet(words:Iterable<string>):Stopwords{
 const folded=new Set([...words].map(fold));
 return {has:term=>folded.has(fold(term))||calendarNumber.test(term.trim())};
}
export async function reportStopwords(reader:Reader){const rows=await reader.rows(sql`SELECT tag FROM tags WHERE no_tag>=1 LIMIT 10001`);if(rows.length>10000)throw new ReportReadBound('Display exclusions exceed read budget');return stopwordSet([...LEGACY_DISPLAY_STOPWORDS,...SITE_DISPLAY_STOPWORDS,...rows.flatMap(r=>typeof r.tag==='string'&&r.tag.trim()?[r.tag.trim()]:[])]);}
export const stopwordNote='顯示排除套用舊站固定清單、本站補充的訂閱與社群連結用語，以及本機 tags.no_tag；英文字母不分大小寫，年份與一、兩位數的數字（如 2026、20、10月）也不列入，三位數以上的數字（如 228）保留。這是呈現規則，不會改動新文易數的共享詞彙。';
