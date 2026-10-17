'use client';

import Link from 'next/link';
import {markPreviewClick} from '@/components/NavPending';
import { useEffect, useLayoutEffect, useRef, useState, useId } from 'react';
import { pictureBox } from './word-cloud';
import styles from './WordCloudView.module.css';

// Draws word clouds laid out on the server (WordCloud) and opens a card with a
// word's numbers on hover or focus; clicking follows the word's link. On touch
// the first tap opens the card, which then carries its own link to follow.

export type CloudTone = 'brand' | 'strong' | 'muted' | 'stone';
export interface CloudCard {
  badge?: { text: string; tone: 'brand' | 'soft' | 'muted' };
  rows: Array<[string, string]>;
}
export interface CloudWordInfo {
  label: string;
  href: string;
  ariaLabel: string;
  tone?: CloudTone;
  fontWeight?: number;
  card?: CloudCard;
  /** Drawn instead of the text: a tag.observe.tw sketch or logo (same-origin path) or an emoji. */
  picture?: CloudPicture;
}
export interface CloudPicture {
  image?: string;
  emoji?: string;
  /** Width ÷ height of a wide picture (a wordmark logo). */
  aspect?: number;
}
export interface PlacedBox {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}
export interface CloudCanvasLayout {
  width: number;
  height: number;
  words: PlacedBox[];
  className: string;
}

const tones: Record<CloudTone, string> = {
  brand: 'fill-brand-700 dark:fill-brand-400',
  strong: 'fill-zinc-800 dark:fill-zinc-200',
  muted: 'fill-zinc-700 dark:fill-zinc-300',
  stone: 'fill-stone-600 dark:fill-stone-400',
};
/** The same colours as `tones`, as `color` for the pictures' flood (feFlood takes currentColor). */
const inks: Record<CloudTone, string> = {
  brand: 'text-brand-700 dark:text-brand-400',
  strong: 'text-zinc-800 dark:text-zinc-200',
  muted: 'text-zinc-700 dark:text-zinc-300',
  stone: 'text-stone-600 dark:text-stone-400',
};
const badges = {
  brand: 'bg-brand-700 text-white dark:bg-brand-600',
  soft: 'bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-300',
  muted: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

function Canvas({
  layout,
  info,
  label,
  title,
}: {
  layout: CloudCanvasLayout;
  info: Record<string, CloudWordInfo>;
  label: string;
  title: string;
}) {
  const [active, setActive] = useState<PlacedBox | null>(null);
  const [tapped, setTapped] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Keeps the card inside the viewport: a sideways nudge, and flipped above the
  // word when there is no room below.
  const [fit, setFit] = useState({ shift: 0, above: false });
  const touch = useRef(false),cardId=useId(),trigger=useRef<Element|null>(null);
  useEffect(()=>{if(active&&tapped)cardRef.current?.focus();},[active?.label,tapped]);
  useEffect(()=>{if(!active||tapped)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setActive(null);setTapped(false);}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[active,tapped]);
  useEffect(() => {
    if (!active || !tapped) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [active, tapped]);
  useLayoutEffect(() => {
    if (!active) return setFit({ shift: 0, above: false });
    const element = cardRef.current;
    if (!element) return;
    const measure = () => {
      const box = root.current?.getBoundingClientRect();
      if (!box) return;
      const { offsetWidth: w, offsetHeight: h } = element;
      const centre = box.left + ((active.x + active.width / 2) / layout.width) * box.width;
      // Not innerWidth: on phones a card poking out widens the page, and innerWidth with it.
      const left = Math.max(12, Math.min(centre - w / 2, document.documentElement.clientWidth - 12 - w));
      const bottom = box.top + ((active.y + active.height) / layout.height) * box.height + 4 + h;
      setFit({ shift: left - (centre - w / 2), above: bottom > document.documentElement.clientHeight - 12 });
    };
    measure();
    // The card settles its size after this first pass (and grows a link when tapped).
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, layout.width, layout.height]);
  const show = (word: PlacedBox | null, byTap = false) => {
    setTapped(byTap);
    setActive(word);
  };
  const { width, height, words, className } = layout;
  const filterId = 'ink' + useId().replace(/[^\w-]/g, '');
  const pictured = words.flatMap((word) => (info[word.label]?.picture?.image ? [info[word.label]] : []));
  const used = [...new Set(pictured.filter((w) => !sketch(w.picture!)).map((w) => w.tone ?? 'strong'))];
  const figures = pictured.some((w) => sketch(w.picture!) && (w.tone ?? 'strong') !== 'brand');
  const card = active ? info[active.label]?.card : undefined;
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  return (
    <div
      ref={root}
      onKeyDown={(event)=>{if(event.key==='Escape'&&active){event.preventDefault();event.stopPropagation();const restore=tapped;show(null);if(restore)(trigger.current as HTMLElement|null)?.focus();}}}
      className={`relative ${className}`}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch') show(null);
      }}
    >
      <svg viewBox={`0 0 ${width} ${height}`} aria-label={label} className="block w-full">
        <title>{title}</title>
        {(used.length > 0 || figures) && (
          <defs>
            {used.map((tone) => (
              <Ink key={tone} id={`${filterId}-${tone}`} className={inks[tone]} />
            ))}
            {figures && <Figure id={`${filterId}-figure`} />}
          </defs>
        )}
        {words.map((word) => {
          const w = info[word.label];
          if (!w) return null;
          return (
            <Link
              key={word.label}
              href={w.href}
              aria-label={w.ariaLabel}
              aria-describedby={active?.label===word.label&&card&&!tapped?cardId:undefined}
              className={styles.word}
              onPointerEnter={(event) => {
                if (event.pointerType !== 'touch') show(word);
              }}
              onPointerDown={(event) => {
                touch.current = event.pointerType === 'touch';trigger.current=event.currentTarget;
              }}
              onKeyDown={() => {
                touch.current = false;
              }}
              onFocus={(event) => {
                trigger.current=event.currentTarget;
                if (!touch.current) show(word);
              }}
              onBlur={(event) => {
                if (!tapped || !root.current?.contains(event.relatedTarget as Node)) show(null);
              }}
              onClick={(event) => {
                if (!touch.current || !w.card || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                if (active?.label === word.label && tapped) return;
                event.preventDefault();
                markPreviewClick(event.nativeEvent);
                show(word, true);
              }}
            >
              <rect x={word.x - 1} y={word.y - 1} width={word.width + 2} height={word.height + 2} rx="3" />
              {w.picture?.image || w.picture?.emoji ? (
                <Sketch picture={w.picture} word={word} tone={tones[w.tone ?? 'strong']} filter={pictureFilter(w, filterId)} />
              ) : (
              <text
                x={word.x + 2}
                y={word.y + word.fontSize * 1.25}
                fontSize={word.fontSize}
                fontWeight={w.fontWeight ?? 600}
                textLength={word.width - 4}
                lengthAdjust="spacingAndGlyphs"
                className={tones[w.tone ?? 'strong']}
              >
                {word.label}
              </text>
              )}
            </Link>
          );
        })}
      </svg>
      {active && card && (
        <div
          ref={cardRef}
          id={cardId}
          role={tapped ? 'dialog' : 'tooltip'}
          aria-label={tapped?active.label:undefined}
          tabIndex={tapped?-1:undefined}
          onBlur={(event)=>{if(tapped&&!root.current?.contains(event.relatedTarget as Node))show(null);}}
          className={`${tapped ? '' : 'pointer-events-none'} absolute z-10 w-max max-w-[16rem] -translate-x-1/2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900`}
          style={{
            left: pct(active.x + active.width / 2, width),
            top: pct(fit.above ? active.y : active.y + active.height, height),
            marginTop: fit.above ? -4 : 4,
            marginLeft: fit.shift,
            transform: fit.above ? 'translateY(-100%)' : undefined,
          }}
        >
          <p className="text-sm font-semibold">
            {active.label}
            {card.badge && (
              <span className={`ml-2 rounded px-1.5 py-px text-[11px] font-medium ${badges[card.badge.tone]}`}>{card.badge.text}</span>
            )}
          </p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums text-zinc-600 dark:text-zinc-400">
            {card.rows.map(([term, value]) => (
              <div key={term} className="contents">
                <dt>{term}</dt>
                <dd className="text-zinc-900 dark:text-zinc-100">{value}</dd>
              </div>
            ))}
          </dl>
          {tapped && (
            <Link
              href={info[active.label].href}
              className="mt-2 block rounded-md bg-zinc-100 px-3 py-2 text-center text-sm font-semibold text-brand-700 active:bg-zinc-200 dark:bg-zinc-800 dark:text-brand-400 dark:active:bg-zinc-700"
              onClick={() => show(null)}
            >
              前往「{active.label}」→
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** A person's sketch: tag.observe.tw's own look, a white figure with strokes on it. */
const sketch = (picture: CloudPicture) => !!picture.image?.includes('/avatar/');
/** Red words keep the served layer as it is (YouTube-red strokes on the white figure);
 *  other sketches get dark strokes on the same white figure; logos take the word's colour. */
function pictureFilter(w: CloudWordInfo, filterId: string) {
  const tone = w.tone ?? 'strong';
  if (!sketch(w.picture!)) return `url(#${filterId}-${tone})`;
  return tone === 'brand' ? undefined : `url(#${filterId}-figure)`;
}

/** Keeps the white figure of a sketch and redraws its red strokes dark (see Ink for how
 *  strokes are read off the green channel), so it reads on light and dark pages alike. */
function Figure({ id }: { id: string }) {
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="1" height="1">
      <feFlood floodColor="#fff" />
      <feComposite in2="SourceAlpha" operator="in" result="figure" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 -1 0 1 0" result="ink" />
      <feFlood floodColor="#27272a" />
      <feComposite in2="ink" operator="in" result="strokes" />
      <feMerge>
        <feMergeNode in="figure" />
        <feMergeNode in="strokes" />
      </feMerge>
    </filter>
  );
}

/**
 * Repaints a tag.observe.tw picture in one colour. The served layer has red
 * strokes on a white figure (logos are red too): ink is how far a pixel is from
 * white, read off its green channel, so strokes keep their weight and the white
 * figure drops out. The flood is the word's own colour, red or the text colour.
 */
function Ink({ id, className }: { id: string; className: string }) {
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="1" height="1">
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 -1 0 1 0" result="ink" />
      <feFlood className={className} style={{ floodColor: 'currentColor' }} />
      <feComposite in2="ink" operator="in" />
    </filter>
  );
}

/** A tag's picture with its name under it in small type, both in the word's colour. */
function Sketch({ picture, word, tone, filter }: { picture: CloudPicture; word: PlacedBox; tone: string; filter?: string }) {
  const { side, pictureWidth, pictureHeight, caption } = pictureBox(word.label, word.fontSize, picture.aspect);
  const x = word.x + (word.width - pictureWidth) / 2;
  return (
    <>
      {picture.image ? (
        <image href={picture.image} x={x} y={word.y} width={pictureWidth} height={pictureHeight} filter={filter} />
      ) : (
        <text x={x + side / 2} y={word.y + side * 0.82} fontSize={side * 0.82} textAnchor="middle">
          {picture.emoji}
        </text>
      )}
      <text x={word.x + word.width / 2} y={word.y + pictureHeight + caption * 1.05} fontSize={caption} fontWeight={600} textAnchor="middle" className={tone}>
        {word.label}
      </text>
    </>
  );
}

export default function WordCloudView({
  canvases,
  info,
  label,
  title,
}: {
  canvases: CloudCanvasLayout[];
  info: Record<string, CloudWordInfo>;
  label: string;
  title: string;
}) {
  return canvases.map((layout) => (
    <Canvas key={`${layout.width}x${layout.height}`} layout={layout} info={info} label={label} title={title} />
  ));
}
