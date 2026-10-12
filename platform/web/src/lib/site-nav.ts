export type NavLink = { href: string; label: string; short: string };
export const NAV_GROUPS: Array<{ label: string; links: NavLink[] }> = [
  { label: '看內容', links: [
    { href: '/videos', label: '最新影片', short: '影片' },
    { href: '/events', label: '事件時間軸', short: '事件' },
    { href: '/ai/days', label: 'AI 議題', short: '議題' },
    { href: '/live/current', label: '即時直播', short: '直播' },
  ] },
  { label: '看趨勢', links: [
    { href: '/keywords', label: '標籤與關鍵字', short: '關鍵字' },
    { href: '/boards', label: '我的看板', short: '看板' },
  ] },
  { label: '看來源', links: [
    { href: '/channels', label: '頻道來源', short: '頻道' },
    { href: '/groups', label: '頻道群組', short: '群組' },
  ] },
  { label: '看寫法', links: [{ href: '/compare/titles', label: '影片標題用語比較', short: '寫法' }] },
];
