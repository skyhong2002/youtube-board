import {reportLinkPrefetch} from "@/lib/report-contract";
import Link from 'next/link';
import TabRowScroll from './TabRowScroll';

export default function SectionTabs({
  label,
  tabs,
  className = '',
}: {
  label: string;
  tabs: Array<{ href: string; label: string; current?: boolean }>;
  className?: string;
}) {
  // A row wider than the screen starts with its current tab in view (TabRowScroll) and fades at the
  // edge it continues past (.scroll-fade), so it reads as scrollable.
  return (
    <nav
      aria-label={label}
      className={`scroll-fade inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1 text-sm [scrollbar-width:none] dark:bg-zinc-900 ${className}`}
    >
      {tabs.map((tab,index) => (
        <Link
          key={`${tab.href}-${index}`}
          href={tab.href}
          prefetch={reportLinkPrefetch(tab.href)}
          aria-current={tab.current ? 'page' : undefined}
          className={`flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-md px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${tab.current ? 'bg-white font-medium text-zinc-950 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-600 hover:bg-white/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'}`}
        >
          {tab.label}
        </Link>
      ))}
      <TabRowScroll />
    </nav>
  );
}
