export type NavLink = { href: string; label: string; short: string };
/** Public reports in the original PHP site's menu order (nav_index.php):
 * 關鍵字、頻道標籤列表、直播排行榜、每日主要事件、新聞集團…; newer surfaces follow. */
export const NAV_GROUPS: Array<{ label: string; links: NavLink[] }> = [
  { label: '報表', links: [
    { href: '/keywords', label: '標籤與關鍵字', short: '關鍵字' },
    { href: '/tags', label: '頻道分類', short: '分類' },
    { href: '/live/current', label: '即時直播', short: '直播' },
    { href: '/ai/days', label: 'AI 議題', short: '議題' },
    { href: '/groups', label: '頻道群組', short: '群組' },
    { href: '/channels', label: '頻道來源', short: '頻道' },
    { href: '/mayor', label: '縣市長選戰聲量', short: '選戰' },
    { href: '/videos', label: '最新影片', short: '影片' },
  ] },
];
