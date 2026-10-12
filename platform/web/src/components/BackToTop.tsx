'use client';

/** The footer's 回到頂端; respects reduced motion and moves focus back to the page start. */
export default function BackToTop() {
  return (
    <button
      type="button"
      onClick={() => {
        const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
        document.querySelector<HTMLElement>('header a, header button')?.focus({ preventScroll: true });
      }}
      className="inline-flex min-h-8 cursor-pointer items-center gap-1 self-start hover:text-brand-700 sm:self-auto dark:hover:text-brand-400"
    >
      回到頂端
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 19V5m0 0-6 6m6-6 6 6" />
      </svg>
    </button>
  );
}
