import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import ThemeSync from '@/components/ThemeSync';
import ScrollReset from '@/components/ScrollReset';
import { siteMetadata, siteViewport } from '@/lib/site';
import { THEME_SCRIPT } from '../../../shared/public-render-contract';
import './globals.css';
export const metadata = siteMetadata;
export const viewport = siteViewport;
// No request reads here: public pages are shared ISR output. The gateway authorizes
// THEME_SCRIPT by the hash of its exact bytes, so it carries no nonce.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className="h-full" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="min-h-full bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <ThemeSync />
        <a href="#main" className="skip-link">跳至主要內容</a>
        <div className="flex min-h-dvh flex-col">
          <ScrollReset />
          <SiteHeader />
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
          <div className="mx-auto w-full max-w-6xl px-4"><SiteFooter /></div>
        </div>
      </body>
    </html>
  );
}
