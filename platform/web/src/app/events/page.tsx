import type {Search} from '@/lib/api';
import {withoutTransportParams} from '@/lib/public-render';
import {filteredEventsMetadata} from '@/lib/seo';
import EventList from './EventList';
// Query variants only: the proxy routes query-free `/events` to /render-isr/events/current.
export const dynamic='force-dynamic';
export const metadata=filteredEventsMetadata();
export default async function Events({searchParams}:{searchParams:Promise<Search>}){
 return <EventList search={withoutTransportParams(await searchParams)}/>;
}
