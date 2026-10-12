'use client';
import { type ReactNode, useId, useState } from 'react';
export default function SourceSidebar({ children, label = '來源資料與觀測' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <aside className="min-w-0 lg:col-start-2 lg:row-start-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded border border-zinc-200 px-3 py-2.5 text-xs text-zinc-600 lg:hidden dark:border-zinc-800 dark:text-zinc-400"
      >
        {label}
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <div id={id} className={`${open ? 'grid' : 'hidden'} mt-3 grid-cols-1 gap-3 sm:grid-cols-2 lg:mt-0 lg:grid lg:grid-cols-1`}>
        {children}
      </div>
    </aside>
  );
}
