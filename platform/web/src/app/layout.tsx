import { headers } from 'next/headers';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import ThemeSync from '@/components/ThemeSync';
import ScrollReset from '@/components/ScrollReset';
import { siteMetadata, siteViewport } from '@/lib/site';
import './globals.css';
export const metadata = siteMetadata;
export const viewport = siteViewport;
const themeScript = `(function(){try{var m=matchMedia('(prefers-color-scheme: dark)');function a(){var s=localStorage.getItem('theme');document.documentElement.dataset.theme=s==='dark'||s==='light'?s:m.matches?'dark':'light'}a();m.addEventListener('change',a)}catch(e){}})()`;
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="zh-Hant" className="h-full" suppressHydrationWarning>
      <head><script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
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
