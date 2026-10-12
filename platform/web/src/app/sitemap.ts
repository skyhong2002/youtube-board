import type {MetadataRoute} from 'next';
import {SITE_ORIGIN} from '@/lib/site';

/** Bounded public entry points. Detail URLs require their own published-source
 * inventory; request/build time is not a truthful content modification date. */
const publicPaths = [
 '/', '/videos', '/channels', '/tags', '/keywords', '/events',
 '/groups', '/mayor', '/ai/days', '/ai/hours', '/ai/periods', '/ai/aspects',
 '/live/current', '/live/channels', '/live/hours', '/live/tags',
 '/live/periods', '/live/trends/daily', '/compare/titles', '/about',
] as const;

export default function sitemap():MetadataRoute.Sitemap {
 return publicPaths.map(path=>({url:new URL(path,SITE_ORIGIN).href}));
}
