import {notFound} from 'next/navigation';
import {enablePublicRevalidation} from '@/lib/api';
import EventList from '../../../events/EventList';
// ISR entry for query-free `/events` (proxy rewrite); see render-isr/home for why the
// segment is dynamic with no build-time params.
export const revalidate=60;
export const dynamicParams=true;
export async function generateStaticParams(){return [];}
export const metadata={title:'事件時間軸'};
export default async function IsrEvents({params}:{params:Promise<{edition:string}>}){
 if((await params).edition!=='current')notFound();
 enablePublicRevalidation();
 return <EventList search={{}}/>;
}
