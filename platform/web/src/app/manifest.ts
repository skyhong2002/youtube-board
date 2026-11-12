import type { MetadataRoute } from 'next';
import { SITE_NAME, SITE_DESCRIPTION, brandAsset } from '@/lib/site';
export default function manifest(): MetadataRoute.Manifest {
  return { name: SITE_NAME, short_name: SITE_NAME, description: SITE_DESCRIPTION, id: '/', start_url: '/', scope: '/', lang: 'zh-Hant', display: 'standalone', background_color: '#fafafa', theme_color: '#ffffff', icons: [
    { src: brandAsset('/brand/icon-192-light.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: brandAsset('/brand/icon-512-light.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: brandAsset('/brand/maskable-192-light.png'), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: brandAsset('/brand/maskable-512-light.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ] };
}
