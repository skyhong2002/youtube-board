import { type CloudSizes, layoutWordCloud } from './word-cloud';
import WordCloudView, { type CloudCanvasLayout, type CloudWordInfo } from './WordCloudView';

export type { CloudCard, CloudTone } from './WordCloudView';

// The site's one word cloud: laid out here on the server (a few hundred terms
// take a noticeable moment to pack), drawn and made hoverable by WordCloudView.
// With a `wide` canvas, `compact` is the phone layout and `wide` takes over
// from md up; without one, `compact` is used everywhere.

export interface CloudCanvas {
  width: number;
  height: number;
  sizes: CloudSizes;
}
export interface CloudWord extends CloudWordInfo {
  /** Sizes the word; larger counts get larger type. */
  count: number;
}

export default function WordCloud({
  words,
  compact,
  wide,
  compactClassName = 'mx-auto w-full max-w-[360px]',
  label,
  title,
}: {
  words: CloudWord[];
  compact: CloudCanvas;
  wide?: CloudCanvas;
  compactClassName?: string;
  label: string;
  title: string;
}) {
  const terms = words.map((w) => ({ label: w.label.trim(), count: w.count }));
  const lay = (canvas: CloudCanvas, className: string): CloudCanvasLayout => ({
    width: canvas.width,
    height: canvas.height,
    className,
    words: layoutWordCloud(terms, canvas.width, canvas.height, canvas.sizes).map(({ label, x, y, width, height, fontSize }) => ({
      label,
      x,
      y,
      width,
      height,
      fontSize,
    })),
  });
  const canvases = wide
    ? [lay(compact, `${compactClassName} md:hidden`), lay(wide, 'hidden w-full md:block')]
    : [lay(compact, compactClassName)];
  if (!canvases.some((c) => c.words.length)) return null;
  // Only words that made it onto a canvas travel to the client.
  const shown = new Set(canvases.flatMap((c) => c.words.map((w) => w.label)));
  const info: Record<string, CloudWordInfo> = {};
  for (const { count: _, ...w } of words) if (shown.has(w.label.trim()) && !Object.hasOwn(info,w.label.trim())) Object.defineProperty(info,w.label.trim(),{value:w,enumerable:true,writable:true,configurable:true});
  return <WordCloudView canvases={canvases} info={info} label={label} title={title} />;
}
