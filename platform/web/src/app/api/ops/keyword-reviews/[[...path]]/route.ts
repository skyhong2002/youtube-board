import {privateProxy} from '@/lib/private-proxy';
/** Development bridge only: production Fastify owns /api/ops/keyword-reviews. privateRoute enforces the exact allowlist. */
export const dynamic='force-dynamic';
const handler=(request:Request)=>privateProxy(request);
export const GET=handler,POST=handler;
