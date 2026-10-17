import Link from 'next/link';
import { Heading } from '@/components/ReportUI';
import { pageMetadata } from '@/lib/seo';
export const metadata = pageMetadata({ title: '標誌與品牌', description: '有影儀表板的標誌、橫式字標與圖示，延續 youtube.board.tw 的紅色播放印記，並提供下載。', path: '/about/brand' });
const modes = ['light', 'dark'] as const;
const label = (mode: (typeof modes)[number]) => mode === 'light' ? '淺色' : '深色';
export default function BrandPage() {
  return <>
    <Heading title="標誌與品牌" method={false} />
    <p className="mb-8 text-sm leading-7 text-zinc-600 dark:text-zinc-400">有影儀表板延續 youtube.board.tw 的名字、觀測工作與紅色印記：播放箭頭穿過直立橢圓環。首頁文字雲中央用印記在上、名稱在下的方形標誌；導覽與頁尾用「有影」、印記、「儀表板」排成一行的橫式字標；網站圖示只放紅色印記。所有 SVG 的中文字都已轉成向量輪廓，不依賴裝置字型。</p>
    <div className="grid gap-4 sm:grid-cols-2">
      {modes.map(mode => <div key={mode} className="min-w-0 rounded-xl border border-zinc-300 p-6 dark:border-zinc-700" style={{ background: mode === 'light' ? '#fafafa' : '#09090b', color: mode === 'light' ? '#1c1c1f' : '#ededed' }}>
        <p className="mb-5 text-xs">{label(mode)}版</p>
        <img src={`/brand/logo-${mode}.svg`} width={512} height={512} className="mx-auto mb-8 h-56 w-56 max-w-full object-contain" alt={`有影儀表板，${label(mode)}方形標誌`} />
        <img src={`/brand/wordmark-${mode}.svg`} width={628} height={120} className="mx-auto h-auto w-full max-w-80" alt="有影儀表板橫式字標" />
        <div className="mt-7 flex min-h-12 items-end justify-center gap-5" aria-label="圖示尺寸預覽">{[16, 32, 48].map(size => <div key={size} className="text-center"><img src={`/brand/icon-${size}-${mode}.svg`} width={size} height={size} alt={`${size} 像素圖示`} className="mx-auto" /><span className="mt-2 block text-[11px]">{size}px</span></div>)}</div>
      </div>)}
    </div>
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 text-sm text-brand-700 dark:text-brand-400">
      {modes.map(mode => <details key={mode} className="rounded-lg border border-zinc-200 px-4 py-2 dark:border-zinc-800"><summary className="cursor-pointer">下載{label(mode)}版</summary><ul className="mt-3 space-y-2">
        {[['logo', '方形標誌 SVG'], ['wordmark', '橫式字標 SVG'], ['icon-16', '16px SVG'], ['icon-32', '32px SVG'], ['icon-48', '48px SVG'], ['icon-180', '180px SVG'], ['icon-192', '192px SVG'], ['icon-512', '512px SVG'], ['maskable', '自適應圖示 SVG'], ['og', '分享圖片 SVG（1200×630）']].map(([file, name]) => <li key={file}><a download href={`/brand/${file}-${mode}.svg`} className="underline underline-offset-4">{name}</a></li>)}
        {[16, 32, 48, 180, 192, 512].map(size => <li key={`png-${size}`}><a download href={`/brand/icon-${size}-${mode}.png`} className="underline underline-offset-4">{size}px PNG</a></li>)}
        <li><a download href={`/brand/favicon-${mode}.ico`} className="underline underline-offset-4">favicon ICO（16／32／48px）</a></li>
        <li><a download href={`/brand/apple-180-${mode}.png`} className="underline underline-offset-4">Apple 180px PNG</a></li>
        <li><a download href={`/brand/maskable-512-${mode}.png`} className="underline underline-offset-4">自適應圖示 512px PNG</a></li>
        <li><a download href={`/brand/og-${mode}.png`} className="underline underline-offset-4">分享圖片 PNG</a></li>
      </ul></details>)}
      <a download href="/brand/mark.svg" className="self-center underline underline-offset-4">紅色印記 SVG（透明底）</a>
    </div>
    <div className="mt-12 border-t border-zinc-200 pt-6 text-xs leading-6 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">字標使用 Noto Serif CJK TC SemiBold 輪廓（<a className="underline" href="/brand/licenses/NotoSerifCJK-OFL.txt">SIL Open Font License</a>）。方形標誌沿用新文易數的上下字標排列（<a className="underline" href="/brand/licenses/tag-observe-MIT.txt">MIT 授權</a>）。<Link href="/about" className="ml-2 underline">資料來源與計算方式</Link></div>
  </>;
}
