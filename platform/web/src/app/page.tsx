import {homeJsonLd,homeMetadata} from '@/lib/seo';
import JsonLd from '@/components/JsonLd';
import HomePage from './_home/HomePage';
// The proxy routes every `/` request to the ISR entry /render-isr/home/current; this
// dynamic copy only answers if that rewrite is ever bypassed, and is never cached.
export const dynamic='force-dynamic';
export const metadata=homeMetadata();
export default function Home(){return <><JsonLd data={homeJsonLd()}/><HomePage/></>;}
