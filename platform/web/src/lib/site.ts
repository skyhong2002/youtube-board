import type { Metadata, Viewport } from 'next';
export const SITE_NAME = '有影儀表板';
export const SITE_DESCRIPTION = '同一件事，各台怎麼說。追蹤 YouTube 頻道、影片與直播，比較公共議題與共同詞彙，從觀測回到來源。';
export const SITE_ORIGIN = 'https://youtube.observe.tw';
export const siteMetadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: SITE_NAME, template: `%s - ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, title: SITE_NAME, description: SITE_DESCRIPTION, locale: 'zh_TW', type: 'website', images: [{ url: '/brand/og-light.png', width: 1200, height: 630, alt: SITE_NAME }] },
  twitter: { card: 'summary_large_image', title: SITE_NAME, description: SITE_DESCRIPTION, images: ['/brand/og-light.png'] },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: 'default' },
  icons: { icon: [{ url: '/brand/icon-light.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: light)' }, { url: '/brand/icon-dark.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: dark)' }, { url: '/favicon.ico', sizes: '16x16 32x32 48x48', type: 'image/x-icon' }], apple: [{ url: '/brand/apple-180-light.png', sizes: '180x180' }] },
  alternates: { types: { 'application/rss+xml': [{ url: '/feeds/videos.xml', title: `${SITE_NAME}｜影片` }] } },
};
export const siteViewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#ffffff' }, { media: '(prefers-color-scheme: dark)', color: '#09090b' }] };
