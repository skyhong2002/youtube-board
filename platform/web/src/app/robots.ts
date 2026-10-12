import type {MetadataRoute} from 'next';
import {SITE_ORIGIN} from '@/lib/site';

/** Discovery guidance only; authentication and authorization stay mandatory. */
export default function robots():MetadataRoute.Robots {
 return {
  rules:{userAgent:'*',allow:'/',disallow:[
   '/auth', '/login', '/my', '/manage', '/ops', '/api/', '/runtime/',
   '/feeds/u/', '/boards', '/redir/', '/prompt/',
  ]},
  sitemap:new URL('/sitemap.xml',SITE_ORIGIN).href,
 };
}
