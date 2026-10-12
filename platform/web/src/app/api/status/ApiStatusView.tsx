'use client';
import { useEffect, useState } from 'react';
import TableScroller from '@/components/TableScroller';
import { openApiPath } from '@/lib/api-docs';
import { SERVICE_LABELS, fetchApiAvailability, type ApiAvailability } from '@/lib/api-status';
import { table } from '@/lib/table-styles';

const border = 'border-b border-zinc-200 align-top dark:border-zinc-800';
const button = 'inline-flex min-h-9 items-center rounded-full border border-zinc-300 px-3 text-sm hover:border-brand-600 disabled:opacity-50 dark:border-zinc-700';
const ok = 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300';
const bad = 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-300';
const taipei = (value: string) => new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'medium' });

/** Sticky endpoint column; at every width each cell stays on one line (long text is cut
 * with an ellipsis and a full-text title) and the table scrolls sideways. */
function Endpoints({ rows, purposes, label }: { rows: ApiAvailability['endpoints']; purposes: Record<string, string>; label: string }) {
  return (
    <TableScroller card label={label}>
      <table className={`w-full text-left text-sm ${table.nowrap} sm:min-w-[36rem]`}>
        <thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400">
          <tr>
            <th scope="col" className={`${table.leadHead} ${border} font-medium`}>端點</th>
            <th scope="col" className={`${table.cell} ${border} font-medium`}>方法</th>
            <th scope="col" className={`${table.cell} ${border} font-medium`}>用途</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const path = openApiPath(e.path);
            const purpose = purposes[`${e.method} ${path}`] ?? '—';
            return (
              <tr key={`${e.method} ${e.path}`} className={table.row}>
                <th scope="row" className={`${table.lead} ${border} text-left font-mono font-normal`}>
                  <div className={table.leadBox}>
                    <span className={`block ${table.leadText}`} title={path}>{path}</span>
                  </div>
                </th>
                <td className={`${table.cell} ${border} whitespace-nowrap font-mono text-xs`}>{e.method}</td>
                <td className={`${table.cell} ${border} whitespace-nowrap`}>
                  <span className={table.clip} title={purpose}>{purpose}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}

export default function ApiStatusView({ purposes }: { purposes: Record<string, string> }) {
  const [data, setData] = useState<ApiAvailability | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let active = true;
    // A retry must not keep showing the previous result as current while the new check runs.
    setData(null);
    setState('loading');
    void fetchApiAvailability(fetch, controller.signal).then((value) => {
      if (!active) return;
      setData(value);
      setState(value ? 'ready' : 'failed');
    });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);
  // Only a completed check may be presented as current; never while a retry is in flight.
  const shown = state === 'ready' ? data : null;
  const current = shown?.endpoints.filter((e) => !e.path.endsWith('.php')) ?? [];
  const legacy = shown?.endpoints.filter((e) => e.path.endsWith('.php')) ?? [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={button} disabled={state === 'loading'} onClick={() => setAttempt((n) => n + 1)}>
          {state === 'loading' ? '檢查中…' : '重新檢查'}
        </button>
        {shown && <p className="text-sm text-zinc-600 dark:text-zinc-400">檢查時間：{taipei(shown.checkedAt)}（台北時間）</p>}
      </div>
      {state === 'loading' && (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">正在檢查 API 狀態…</p>
      )}
      {state === 'failed' && (
        <p role="alert" className="rounded-xl border border-zinc-300 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          暫時無法取得 API 狀態，請稍後重新檢查。無法取得狀態不代表資料為零。
        </p>
      )}
      {shown && (
        <>
          <section aria-labelledby="availability" className="space-y-3">
            <h2 id="availability" className="text-lg font-semibold">服務可用性</h2>
            <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
              {shown.status === 'ok' ? '公開 API 目前可以回應。' : '公開 API 目前部分無法使用，請稍後再試。'}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {shown.services.map((service) => (
                <div key={service.id} className="rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{SERVICE_LABELS[service.id]}</h3>
                    <span className={service.status === 'ok' ? ok : bad}>{service.status === 'ok' ? '可用' : '無法使用'}</span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">/api/v1 報表端點能否在時限內回應；不檢查資料是否為最新。</p>
                </div>
              ))}
            </div>
          </section>
          <section aria-labelledby="endpoints" className="min-w-0 space-y-3">
            <h2 id="endpoints" className="text-lg font-semibold">端點用途</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              共 {shown.endpoints.length} 個公開 GET 端點。參數與回應欄位見 <a href="/api" className="text-brand-700 underline underline-offset-2 dark:text-brand-400">API 文件</a>。
            </p>
            <Endpoints rows={current} purposes={purposes} label="公開 API 端點（可左右捲動）" />
            {legacy.length > 0 && (
              <details className="rounded-lg border border-zinc-300 dark:border-zinc-800">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">舊版 PHP 相容端點（{legacy.length}）</summary>
                <div className="min-w-0 px-3 pb-3">
                  <Endpoints rows={legacy} purposes={purposes} label="舊版相容端點（可左右捲動）" />
                </div>
              </details>
            )}
          </section>
        </>
      )}
    </>
  );
}
