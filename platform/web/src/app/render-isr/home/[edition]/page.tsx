import {notFound} from 'next/navigation';
import {enablePublicRevalidation} from '@/lib/api';
import HomePage from '../../../_home/HomePage';
// ISR entry for `/` (proxy rewrite). A dynamic segment with no build-time params keeps
// `next build` from baking a homepage while the API is unreachable; the first request
// renders it, and a failed read throws instead of caching an unavailable page.
export const revalidate=60;
export const dynamicParams=true;
export async function generateStaticParams(){return [];}
export default async function IsrHome({params}:{params:Promise<{edition:string}>}){
 if((await params).edition!=='current')notFound();
 enablePublicRevalidation();
 return <HomePage/>;
}
