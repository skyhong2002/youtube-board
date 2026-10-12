'use client';
import { useEffect, useState } from 'react';
import { OPT_OUT_EVENT, readOptOut, writeOptOut } from '@/lib/analytics-consent';

const storage = () => { try { return window.localStorage; } catch { return null; } };
const button = 'inline-flex min-h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium hover:border-brand-600 hover:text-brand-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-brand-400 dark:hover:text-brand-400';

/** The choice lives in this browser's localStorage for youtube.observe.tw only. */
export default function OptOutPanel() {
  const [state, setState] = useState<'loading' | 'in' | 'out' | 'unavailable'>('loading');
  useEffect(() => { setState(storage() ? readOptOut(storage()) ? 'out' : 'in' : 'unavailable'); }, []);
  const choose = (optedOut: boolean) => {
    if (!writeOptOut(storage(), optedOut)) { setState('unavailable'); return; }
    if (optedOut) window.dispatchEvent(new Event(OPT_OUT_EVENT));
    setState(optedOut ? 'out' : 'in');
  };
  return (
    <section aria-live="polite" className="mt-6 rounded-xl border border-zinc-300 bg-white p-5 text-sm leading-7 dark:border-zinc-800 dark:bg-zinc-900">
      {state === 'loading' ? <p role="status">正在讀取此瀏覽器的設定…</p>
        : state === 'unavailable' ? <p role="alert">此瀏覽器無法儲存設定（可能停用了網站資料儲存），因此本站不會載入 Google Analytics。</p>
        : state === 'out' ? <>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">已停用：此瀏覽器不會再載入 Google Analytics。</p>
          <p className="text-zinc-600 dark:text-zinc-400">清除網站資料或改用其他瀏覽器、裝置時，需要重新設定。</p>
          <button type="button" className={button + ' mt-3'} onClick={() => choose(false)}>恢復網站分析</button>
        </>
        : <>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">目前：公開頁面可能使用 Google Analytics 統計瀏覽情形。</p>
          <button type="button" className={button + ' mt-3'} onClick={() => choose(true)}>停用此瀏覽器的網站分析</button>
        </>}
      {state === 'in' && <p className="mt-3 text-xs text-zinc-500">恢復後，於下次載入公開頁面時生效。</p>}
    </section>
  );
}
