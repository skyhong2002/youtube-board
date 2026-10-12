import {privateProxy} from '@/lib/private-proxy';
export const dynamic='force-dynamic';
const handler=(request:Request)=>privateProxy(request);
export const GET=handler,POST=handler;
