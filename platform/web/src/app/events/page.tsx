import type {Search} from '@/lib/api';
import {withoutTransportParams} from '@/lib/public-render';
import EventList from './EventList';
// Query variants only: the proxy rewrites query-free `/events` to /render-isr/events/current.
export const dynamic='force-dynamic';
export const metadata={title:'事件時間軸'};
export default async function Events({searchParams}:{searchParams:Promise<Search>}){
 return <EventList search={withoutTransportParams(await searchParams)}/>;
}
