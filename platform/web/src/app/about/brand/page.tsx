import Link from 'next/link';
import { Heading } from '@/components/ReportUI';
export const metadata = { title: '標誌與品牌' };
const candidates = [
  { key: 'family', title: '新文易數同家族・舊站印記', label: '網站目前採用', description: '「有影／儀表板」沿用母站的宋體與上下排列，中間嵌入播放箭頭穿過直立橢圓環的舊站印記。小圖示以「影」字搭配加粗、簡化的舊標，在小尺寸保留辨識度。' },
  { key: 'legacy', title: '延續舊站', label: '備選方案', description: '沿用 youtube.board.tw 的播放箭頭穿過直立橢圓環，重新整理曲線與比例，並換上 YouTube 紅。' },
  { key: 'original', title: '影像與觀測', label: '備選方案', description: '用螢幕框、播放鍵與三條觀測柱狀線，表達從影片觀看議題與數據的儀表板。' },
];
export default function BrandPage() {
  return <>
    <Heading title="標誌與品牌" description="有影儀表板，延續 youtube.board.tw 的名字與觀測工作。三款標誌使用相同的 YouTube 紅，這裡可以預覽與下載。" />
    <p className="mb-8 text-sm leading-7 text-zinc-600 dark:text-zinc-400">網站目前採用「新文易數同家族・舊站印記」。下方並排展示新版大圖與 16／32／48px 實際尺寸。所有 SVG 的中文字都已轉成向量輪廓，不依賴裝置字型；深淺色版本與應用程式圖示都已備妥。</p>
    <div className="space-y-12">
      {candidates.map(candidate => <section key={candidate.key} aria-labelledby={`brand-${candidate.key}`}>
        <div className="mb-4 flex flex-wrap items-center gap-3"><h2 id={`brand-${candidate.key}`} className="text-xl font-semibold">{candidate.title}</h2><span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-700">{candidate.label}</span></div>
        <p className="mb-5 text-sm leading-7 text-zinc-600 dark:text-zinc-400">{candidate.description}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['light', 'dark'] as const).map(mode => <div key={mode} className="min-w-0 rounded-xl border border-zinc-300 p-6 dark:border-zinc-700" style={{ background: mode === 'light' ? '#fafafa' : '#09090b', color: mode === 'light' ? '#1c1c1f' : '#ededed' }}>
            <p className="mb-5 text-xs">{mode === 'light' ? '淺色版' : '深色版'}</p>
            <img src={`/brand/${candidate.key}/logo-${mode}.svg`} width={512} height={512} className="mx-auto mb-8 h-56 w-56 max-w-full object-contain" alt={`${candidate.title}，${mode === 'light' ? '淺色' : '深色'}標誌`} />
            <img src={`/brand/${candidate.key}/wordmark-${mode}.svg`} width={candidate.key === 'family' ? 532 : 612} height={100} className="mx-auto h-auto w-full max-w-80" alt="有影儀表板" />
            <div className="mt-7 flex min-h-12 items-end justify-center gap-5" aria-label="圖示尺寸預覽">{[16, 32, 48].map(size => <div key={size} className="text-center"><img src={`/brand/${candidate.key}/icon-${size}-${mode}.svg`} width={size} height={size} alt={`${size} 像素圖示`} className="mx-auto" /><span className="mt-2 block text-[11px]">{size}px</span></div>)}</div>
          </div>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 text-sm text-brand-700 dark:text-brand-400">
          {(['light', 'dark'] as const).map(mode => <details key={mode} className="rounded-lg border border-zinc-200 px-4 py-2 dark:border-zinc-800"><summary className="cursor-pointer">下載{mode === 'light' ? '淺色' : '深色'}版</summary><ul className="mt-3 space-y-2">
            {[['logo', '標誌 SVG'], ['wordmark', '橫式字標 SVG'], ['icon-16', '16px SVG'], ['icon-32', '32px SVG'], ['icon-48', '48px SVG'], ['icon-180', '180px SVG'], ['icon-192', '192px SVG'], ['icon-512', '512px SVG'], ['maskable', '自適應圖示 SVG'], ['og', '分享圖片 SVG（1200×630）']].map(([file, label]) => <li key={file}><a download href={`/brand/${candidate.key}/${file}-${mode}.svg`} className="underline underline-offset-4">{label}</a></li>)}
            {[16, 32, 48, 180, 192, 512].map(size => <li key={`png-${size}`}><a download href={`/brand/${candidate.key}/icon-${size}-${mode}.png`} className="underline underline-offset-4">{size}px PNG</a></li>)}
            <li><a download href={`/brand/${candidate.key}/favicon-${mode}.ico`} className="underline underline-offset-4">favicon ICO（16／32／48px）</a></li>
            <li><a download href={`/brand/${candidate.key}/apple-180-${mode}.png`} className="underline underline-offset-4">Apple 180px PNG</a></li>
            <li><a download href={`/brand/${candidate.key}/maskable-512-${mode}.png`} className="underline underline-offset-4">自適應圖示 512px PNG</a></li>
            <li><a download href={`/brand/${candidate.key}/og-${mode}.png`} className="underline underline-offset-4">分享圖片 PNG</a></li>
          </ul></details>)}
        </div>
      </section>)}
    </div>
    <div className="mt-12 border-t border-zinc-200 pt-6 text-xs leading-6 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">字標使用 Noto Serif CJK TC SemiBold 輪廓（<a className="underline" href="/brand/licenses/NotoSerifCJK-OFL.txt">SIL Open Font License</a>）。同家族方案沿用新文易數的字標排列，並以舊站標誌取代雙半圓（<a className="underline" href="/brand/licenses/tag-observe-MIT.txt">MIT 授權</a>）。<Link href="/about" className="ml-2 underline">資料來源與計算方式</Link></div>
  </>;
}
