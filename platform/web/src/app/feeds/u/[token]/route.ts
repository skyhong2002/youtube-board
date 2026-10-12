import {privateProxy} from '@/lib/private-proxy';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>privateProxy(request);
