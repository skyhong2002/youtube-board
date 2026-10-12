'use client';

import { useState } from 'react';

// Google profile picture, falling back to the name's first character. A plain
// <img> keeps googleusercontent.com out of the next/image host allowlist;
// no-referrer because that host sometimes refuses requests carrying one.
export default function Avatar({ src, label, size = 36 }: { src: string | null; label: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const box =
    'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-medium text-brand-800 dark:bg-brand-900 dark:text-brand-200';
  return (
    <span className={box} style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {src && /^https:\/\/[^/]+\.googleusercontent\.com\//.test(src) && !broken ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        Array.from(label)[0]?.toUpperCase()
      )}
    </span>
  );
}
