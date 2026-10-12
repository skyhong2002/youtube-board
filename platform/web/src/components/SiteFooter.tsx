import Link from 'next/link';
import BackToTop from './BackToTop';
import Wordmark from './Wordmark';

// Shared family footer with YouTube provenance and supported product links.

type FooterLink = { href: string; label: string; external?: boolean };
// Only what the header does not already link: its sections stay up there, and
// search has the header's box. Channels are the buttons under the brand.
const COLUMNS: Array<{ label: string; links: FooterLink[] }> = [
  { label: '資料與透明度', links: [
    { href: '/about', label: '資料來源與計算方式' },
    { href: '/vocabulary', label: '共同標籤詞彙' },
    { href: '/live/walls/news', label: '直播電視牆' },
    { href: '/about/brand', label: '有影儀表板識別' },
    { href: '/observe/opt-out', label: '停用網站分析' },
  ] },
  { label: '開發與來源', links: [
    { href: 'https://github.com/skyhong2002/youtube-board/issues', label: '問題回報', external: true },
    { href: 'https://tag.observe.tw', label: '新文易數', external: true },
    { href: 'https://youtube.board.tw', label: '舊版 YouTube Board', external: true },
  ] },
];

const link = 'inline-flex min-h-8 items-center py-0.5 hover:text-brand-700 hover:underline underline-offset-4 dark:hover:text-brand-400';
const pill =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 text-[13px] text-zinc-700 transition-colors hover:border-brand-600 hover:text-brand-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-brand-400 dark:hover:text-brand-400';
// The band reaches the viewport edges from inside the centred column without
// widening the page: a spread shadow in the band colour, clipped vertically.
const band =
  'bg-zinc-50 shadow-[0_0_0_100vmax_var(--color-zinc-50)] [clip-path:inset(0_-100vmax)] dark:bg-zinc-900 dark:shadow-[0_0_0_100vmax_var(--color-zinc-900)]';

const Icon = ({ d, fill = false }: { d: string; fill?: boolean }) => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    aria-hidden="true"
    className="shrink-0"
    {...(fill ? { fill: 'currentColor' } : { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const })}
  >
    <path d={d} />
  </svg>
);
const ICONS = {
  rss: 'M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14M6 19h.01',
  github:
    'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 2.9.8.1-.7.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.5-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .6 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z',
};

export default function SiteFooter() {
  return (
    <footer className="mt-14 text-sm text-zinc-600 dark:text-zinc-400">
      <section aria-label="資料來源與計算方式" className="border-t border-zinc-200 pt-6 text-xs leading-6 dark:border-zinc-800">
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">資料來源與計算方式</h2>
        <p>影片、頻道與直播觀測來自 YouTube；共同標籤詞彙來自 <a className="underline underline-offset-4" href="https://tag.observe.tw">新文易數 tag.observe.tw</a>。標籤保留來源、版本與比對依據。</p>
        <p>影片數、觀看數與直播同時在線人數分別計算，不代表 YouTube 全站流量或因果關係。更新時間與資料涵蓋範圍以各報表標示為準。</p>
      </section>

      <div className={`${band} mt-10 pt-12 pb-6`}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20">
          <div className="space-y-5">
            <Link href="/" aria-label="有影儀表板 首頁" className="inline-block text-zinc-900 dark:text-zinc-100">
              <Wordmark className="h-9 w-auto" />
            </Link>
            <div className="space-y-1.5">
              <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">看見影片，也看見公共議題。</p>
              <p className="leading-7">
                延續 YouTube Board 的資料觀測，<span className="whitespace-nowrap">追蹤頻道、直播與事件脈絡。</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="/feeds/videos.xml" className={pill}>
                <Icon d={ICONS.rss} />
                RSS
              </a>
              <a href="https://github.com/skyhong2002/youtube-board" target="_blank" rel="noopener noreferrer" className={pill}>
                <Icon d={ICONS.github} fill />
                GitHub
              </a>

            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:max-w-md sm:gap-x-16 lg:max-w-none">
            {COLUMNS.map((col) => (
              <nav key={col.label} aria-label={col.label}>
                <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-zinc-900 dark:text-zinc-100">{col.label}</h2>
                <ul className="space-y-0.5">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      {l.external ? (
                        <a href={l.href} target="_blank" rel="noopener noreferrer" className={link}>
                          {l.label}
                          <span aria-hidden="true" className="ml-0.5 text-zinc-400">
                            ↗
                          </span><span className="sr-only">（另開新視窗）</span>
                        </a>
                      ) : (
                        <Link href={l.href} className={link}>
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-zinc-200 pt-5 text-xs leading-6 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
          <p>
            © 2026 有影儀表板 · 影片、標題與圖片著作權屬原作者；頻道數據依來源觀測記錄。
          </p>
          <BackToTop />
        </div>
      </div>
    </footer>
  );
}
