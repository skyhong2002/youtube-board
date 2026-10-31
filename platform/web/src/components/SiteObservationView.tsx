import Link from 'next/link';
import type { SiteObservation, ObservedPage } from '../../../api/src/reports/site-observation';
import { KIND_LABELS, OBSERVATION_DAYS, shiftDay, type ObservationDays } from '../../../shared/site-analytics';
import MethodLink from './MethodLink';
import PageMethod from './PageMethod';
import { ObserveMethod } from './method/observe';
import Sparkline from './Sparkline';
import { dateTime } from '@/lib/format';

// 本站流量 (/observe), as tag.observe.tw app/(site)/observe/page.tsx. Server-rendered: the daily bars are plain SVG
// with a per-bar tooltip and a table view, so the page needs no chart runtime.

const CHANNELS: Record<string, string> = {
  Direct: '直接造訪', 'Organic Search': 'Google 等搜尋', 'Organic Social': '社群網站', Referral: '其他網站連結', Unassigned: '未指派',
  'Cross-network': '跨聯播網', Email: '電子郵件', 'Organic Video': '影音平台', 'Paid Search': '付費搜尋',
};
const DEVICES: Record<string, string> = { desktop: '電腦', mobile: '手機', tablet: '平板' };
const EVENTS: Record<string, string> = { open_original: '點開 YouTube 原影片', select_content: '從列表點進頻道、影片或議題', rss_click: '點 RSS' };
const VITALS: Record<string, string> = { LCP: '主要內容出現', INP: '操作反應', CLS: '版面穩定' };

const n = (value: number) => value.toLocaleString('zh-TW');
const card = 'rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900';
const link = 'text-brand-700 hover:underline dark:text-brand-400';
const muted = 'text-xs text-zinc-600 dark:text-zinc-400';

export const observeHref = (days: ObservationDays) => (days === 28 ? '/observe' : `/observe?days=${days}`);

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={card}>
      <div className={muted}>{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {note && <div className={`mt-1 ${muted}`}>{note}</div>}
    </div>
  );
}

function Live({ live }: { live: NonNullable<SiteObservation['live']> }) {
  const time = new Date(live.fetchedAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <section className={`${card} flex flex-wrap items-center gap-x-6 gap-y-3`} aria-label="最近 30 分鐘">
      <p className="flex items-center gap-2 text-sm">
        <span className={`inline-flex h-2.5 w-2.5 rounded-full ${live.activeUsers > 0 ? 'bg-emerald-500' : 'bg-zinc-400'}`} aria-hidden="true" />
        最近 30 分鐘
      </p>
      <p className="text-sm"><span className="text-2xl font-semibold tabular-nums tracking-tight">{n(live.activeUsers)}</span> 位讀者</p>
      <p className="text-sm"><span className="text-2xl font-semibold tabular-nums tracking-tight">{n(live.views)}</span> 次瀏覽</p>
      <div className="flex w-full items-center justify-between gap-2 text-brand-600 sm:w-auto sm:flex-1 sm:justify-end dark:text-brand-400">
        <Sparkline values={live.perMinute} className="h-8 w-40 max-w-full" />
        <span className={`shrink-0 ${muted}`}>每分鐘瀏覽 · {time}</span>
      </div>
    </section>
  );
}

function Section({ title, aside, id, children }: { title: string; aside?: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={card}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {aside && <span className={muted}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">{children}</p>;

/** Shares of one total: one hue, bars scaled to the largest row, the number and percentage in text. */
function Shares({ rows, labels, unit }: { rows: Array<{ name: string; value: number }>; labels: Record<string, string>; unit: string }) {
  const total = rows.reduce((sum, r) => sum + r.value, 0) || 1, max = Math.max(1, ...rows.map(r => r.value));
  return (
    <ul className="space-y-2.5 text-sm">
      {rows.map(r => (
        <li key={r.name}>
          <div className="flex justify-between gap-3">
            <span>{labels[r.name] ?? r.name}</span>
            <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{n(r.value)} {unit} · {Math.round((r.value / total) * 100)}%</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full rounded-full bg-brand-600 dark:bg-brand-400" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PageList({ pages, value }: { pages: Array<Omit<ObservedPage, 'views'>>; value: (i: number) => string }) {
  return (
    <ol className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
      {pages.map((p, i) => (
        <li key={p.path} className="flex items-baseline gap-3 py-2">
          <span className="w-5 shrink-0 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{i + 1}</span>
          <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{KIND_LABELS[p.kind]}</span>
          <Link href={p.path} prefetch={false} className={`min-w-0 flex-1 truncate ${link}`} title={p.title}>{p.title}</Link>
          <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-400">{value(i)}</span>
        </li>
      ))}
    </ol>
  );
}

const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
/** One measure per day as SVG bars (null = before tracking began: no bar), hover titles and a table view.
 * A partial last day (today) is drawn lighter. */
export function DailyBars({ label, name, days, values, partialLast = false }: { label: string; name: string; days: string[]; values: (number | null)[]; partialLast?: boolean }) {
  const max = Math.max(1, ...values.map(v => v ?? 0)), slot = 10, height = 100, last = days.length - 1;
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${days.length * slot} ${height}`} preserveAspectRatio="none" className="h-44 w-full text-brand-600 dark:text-brand-400" role="img" aria-label={label}>
        <line x1="0" x2={days.length * slot} y1={height} y2={height} stroke="currentColor" strokeOpacity="0.15" vectorEffect="non-scaling-stroke" />
        {days.map((day, i) => {
          const v = values[i] ?? null, h = v === null ? 0 : Math.max(v > 0 ? 1 : 0, (v / max) * (height - 4));
          const tip = `${day}${partialLast && i === last ? '（今天，累計中）' : ''}：${v === null ? '尚未開始追蹤' : `${name} ${n(v)}`}`;
          return (
            <g key={day}>
              <title>{tip}</title>
              <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
              {v !== null && <rect x={i * slot + 1} y={height - h} width={slot - 2} height={h} fill="currentColor" opacity={partialLast && i === last ? 0.45 : 1} />}
            </g>
          );
        })}
      </svg>
      <div className={`mt-1 flex justify-between ${muted}`}><span>{days[0] && shortDay(days[0])}</span><span>{days.at(-1) && shortDay(days.at(-1)!)}</span></div>
      <details className={`mt-2 ${muted}`}>
        <summary className="cursor-pointer py-1">查看數值表格（{days.length} 天）</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead><tr><th className="py-1 font-medium">日期</th><th className="py-1 text-right font-medium">{name}</th></tr></thead>
          <tbody>{days.map((day, i) => <tr key={day}><td className="py-0.5">{day}</td><td className="py-0.5 text-right tabular-nums">{values[i] === null ? '—' : n(values[i]!)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

function Vitals({ vitals }: { vitals: NonNullable<SiteObservation['vitals']> }) {
  const parts = [
    { key: 'good', label: '良好', className: 'bg-emerald-600 dark:bg-emerald-500' },
    { key: 'needsImprovement', label: '需改善', className: 'bg-amber-500 dark:bg-amber-400' },
    { key: 'poor', label: '不佳', className: 'bg-red-700 dark:bg-red-500' },
  ] as const;
  return (
    <ul className="space-y-4 text-sm">
      {vitals.map(v => {
        const total = v.good + v.needsImprovement + v.poor;
        return (
          <li key={v.name}>
            <div className="flex justify-between gap-3">
              <span><span className="font-medium">{v.name}</span> {VITALS[v.name]}</span>
              <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{n(total)} 份樣本</span>
            </div>
            {total > 0 && (
              <>
                <div className="mt-1.5 flex h-2 gap-0.5 overflow-hidden rounded-full">
                  {parts.map(p => v[p.key] > 0 && <div key={p.key} className={p.className} style={{ flexGrow: v[p.key] }} />)}
                </div>
                <p className={`mt-1 ${muted}`}>{parts.map(p => `${p.label} ${Math.round((v[p.key] / total) * 100)}%`).join(' · ')}</p>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Every day of the period; days before tracking began have no bar. */
function series(data: SiteObservation) {
  const days = Array.from({ length: data.days }, (_, i) => shiftDay(data.start, i));
  const byDay = new Map(data.traffic?.daily.map(d => [d.date, d.views]));
  return { days, values: days.map(d => byDay.get(d) ?? (data.trackingSince && d >= data.trackingSince ? 0 : null)) };
}

export default function SiteObservationView({ data, days }: { data: SiteObservation | null; days: ObservationDays }) {
  const traffic = data?.traffic, search = data?.search, views = data && series(data);
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">本站流量</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            本站的讀者從哪裡來、看了什麼
            {data?.updatedAt && ` · 更新於 ${dateTime(data.updatedAt)} · 台北時間`}
            {data?.trackingSince && ` · ${data.trackingSince.replaceAll('-', '/')} 起`}
          </p>
        </div>
        <MethodLink className="text-sm" />
      </header>
      <nav aria-label="期間" className="flex flex-wrap gap-2 text-sm">
        {OBSERVATION_DAYS.map(d => (
          <Link key={d} href={observeHref(d)} prefetch={false} aria-current={d === days ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 ${d === days ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-400 dark:bg-brand-400 dark:text-zinc-950' : 'border-zinc-300 hover:border-brand-600 dark:border-zinc-700'}`}>
            近 {d} 天
          </Link>
        ))}
      </nav>

      {!data ? (
        <p role="status" className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">觀測資料暫時無法取得，請稍後再試。</p>
      ) : (
        <>
          {data.live && <Live live={data.live} />}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="瀏覽" value={traffic ? n(traffic.views) : '—'} note={traffic ? undefined : '尚無資料'} />
            <Tile label="造訪" value={traffic ? n(traffic.sessions) : '—'} note={traffic ? undefined : '尚無資料'} />
            <Tile label="Google 搜尋點擊" value={search ? n(search.clicks) : '—'} note={search ? undefined : '尚無資料'} />
            <Tile label="Google 搜尋曝光" value={search ? n(search.impressions) : '—'} note={search?.position ? `平均排名 ${search.position}` : search ? undefined : '尚無資料'} />
          </div>

          <Section title="每日瀏覽" aside={traffic ? '今天的長條較淡：仍在累計' : undefined}>
            {views && traffic ? <DailyBars label="每日網頁瀏覽次數" name="瀏覽" days={views.days} values={views.values} partialLast /> : <Empty>還沒有瀏覽資料。</Empty>}
          </Section>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Section id="readers" title="讀者關注" aside="內容頁瀏覽次數">
              {data.content.length ? <PageList pages={data.content} value={i => n(data.content[i]!.views)} /> : <Empty>這段期間還沒有內容頁的瀏覽。</Empty>}
            </Section>
            <div className="space-y-5">
              <Section title="從哪裡來" aside="造訪次數">
                {traffic?.channels.length ? <Shares rows={traffic.channels} labels={CHANNELS} unit="次" /> : <Empty>尚無資料。</Empty>}
              </Section>
              <Section title="用什麼裝置" aside="造訪次數">
                {traffic?.devices.length ? <Shares rows={traffic.devices} labels={DEVICES} unit="次" /> : <Empty>尚無資料。</Empty>}
              </Section>
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
            <Section title="熱門頁面" aside="含首頁與列表頁">
              {data.pages.length ? <PageList pages={data.pages.slice(0, 10)} value={i => n(data.pages[i]!.views)} /> : <Empty>尚無資料。</Empty>}
            </Section>
            <Section title="讀者做了什麼">
              {traffic?.events.length ? (
                <dl className="grid grid-cols-2 gap-3">
                  {traffic.events.map(e => (
                    <div key={e.name}>
                      <dt className={muted}>{EVENTS[e.name] ?? e.name}</dt>
                      <dd className="text-xl font-semibold tabular-nums">{n(e.value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : <Empty>尚無互動紀錄。</Empty>}
            </Section>
          </div>

          <Section title="Google 搜尋" aside={search ? '美國太平洋時間，近 2–3 天可能仍會修正' : undefined}>
            {search ? (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="min-w-0 space-y-4">
                  <div>
                    <h3 className={`mb-1 ${muted}`}>每日點擊</h3>
                    <DailyBars label="每日 Google 搜尋點擊" name="點擊" days={search.daily.map(d => d.date)} values={search.daily.map(d => d.clicks)} />
                  </div>
                  <div>
                    <h3 className={`mb-1 ${muted}`}>每日曝光</h3>
                    <DailyBars label="每日 Google 搜尋曝光" name="曝光" days={search.daily.map(d => d.date)} values={search.daily.map(d => d.impressions)} />
                  </div>
                </div>
                <div>
                  <h3 className={`mb-1 ${muted}`}>搜尋帶來最多點擊的頁面</h3>
                  {search.pages.length ? (
                    <PageList pages={search.pages} value={i => `${n(search.pages[i]!.clicks)} 點擊 / ${n(search.pages[i]!.impressions)} 曝光`} />
                  ) : <Empty>還沒有頁面獲得搜尋點擊。</Empty>}
                </div>
              </div>
            ) : <Empty>Search Console 還沒有回傳搜尋資料。</Empty>}
          </Section>

          <Section title="使用體驗" aside={data.vitals ? '讀者瀏覽器回報的樣本' : undefined}>
            {data.vitals ? <Vitals vitals={data.vitals} /> : <Empty>還沒有讀者瀏覽器回報的使用體驗樣本。</Empty>}
          </Section>
        </>
      )}
      <PageMethod><ObserveMethod /></PageMethod>
    </div>
  );
}
