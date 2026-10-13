'use client';
import {useLinkStatus} from 'next/link';

/** Inline pending feedback for a Next <Link> (installed docs: 04-functions/use-link-status.md).
 * The F2 keyword routes are dynamic and deliberately have no loading.js (a Suspense fallback would
 * commit a 200 before the server read can fail), so a click can wait on the server render with no
 * other sign. This hint is the only addition: the link, its label, href/date filters and the current
 * page stay as they are until Next swaps the route. A prefetched or fast route may skip the pending
 * phase entirely; nothing here forces a delay, retries or changes prefetching.
 *
 * Fixed 0.75rem box rendered in both states so the row never shifts; only opacity and the ring's
 * rotation change. The ring fades in after 150ms so quick navigations do not flash, and it inherits
 * the link colour (brand red in light and dark). The polite status text is the honest
 * screen-reader equivalent: it says loading, never a count or a placeholder row. */
export function LinkPendingHint({pending,className=''}:{pending:boolean;className?:string}){
 return <span className={`inline-flex size-3 shrink-0 items-center justify-center ${className}`} data-link-pending={pending?'pending':'idle'}>
  <span aria-hidden="true" className={`block size-2.5 rounded-full border-[1.5px] border-current border-t-transparent transition-opacity duration-150 motion-reduce:transition-none ${pending?'opacity-100 delay-150 motion-safe:animate-spin':'opacity-0'}`}/>
  <span role="status" className="sr-only">{pending?'頁面載入中':''}</span>
 </span>;
}

/** Must be rendered inside the <Link> it reports on (useLinkStatus reads the nearest Link). */
export default function LinkPending({className}:{className?:string}){
 const {pending}=useLinkStatus();
 return <LinkPendingHint pending={pending} className={className}/>;
}
