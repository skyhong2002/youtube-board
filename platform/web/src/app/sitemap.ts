import type {MetadataRoute} from 'next';
import {SITE_ORIGIN} from '@/lib/site';

/** Bounded public entry points. Detail URLs require their own published-source
 * inventory; request/build time is not a truthful content modification date. */
const publicPaths = [
 '/', '/videos', '/channels', '/tags', '/keywords', '/vocabulary', '/events',
 '/groups', '/mayor', '/ai/days', '/ai/hours', '/ai/periods', '/ai/aspects',
 '/live/current', '/live/channels', '/live/hours', '/live/tags',
 '/live/periods', '/live/trends/daily', '/compare/titles', '/about',
 // Exact public API docs page only; /api/* (status, v1, private) stays out.
 '/api',
] as const;

export default function sitemap():MetadataRoute.Sitemap {
 return publicPaths.map(path=>({url:new URL(path,SITE_ORIGIN).href}));
}
