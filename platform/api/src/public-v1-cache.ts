import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';

const V1=/^\/api\/v1(?:\/|$)/;
const partialReplies=new WeakSet<FastifyReply>();
/** Explicitly partial successful data must not enter the public HTTP cache. */
export function markPublicV1Partial(reply:FastifyReply){partialReplies.add(reply);}
/** Uses route templates so an opaque keyword containing /live cannot select a TTL. */
function publicV1Path(request:FastifyRequest){
 const route=request.routeOptions.url;
 return route&&V1.test(route)?route:request.url.split('?')[0]!;
}
export function publicV1Ttl(path:string):number{
 if(path==='/api/v1'||path==='/api/v1/openapi.json')return 3600;
 if(path==='/api/v1/status')return 0;
 if(/\/live(?:\/|$)/.test(path))return 30;
 if(path==='/api/v1/vocabulary'||path==='/api/v1/keywords')return 300;
 return 60;
}
/** Cache-only policy: no auth, database, quota, catalog or schema dependency.
 * Returns false outside v1; legacy/private routes retain their existing policy. */
export function applyPublicV1Cache(request:FastifyRequest,reply:FastifyReply):boolean{
 const path=publicV1Path(request);if(!V1.test(path))return false;
 // The full API policy owns preflight caching; this read-only hook does not.
 if(request.method==='OPTIONS'&&reply.statusCode<400)return true;
 const vary=new Map<string,string>();
 for(const token of String(reply.getHeader('Vary')??'').split(',').map(v=>v.trim()).filter(Boolean))vary.set(token.toLowerCase(),token);
 for(const name of ['Accept','X-Api-Key','Authorization','Cookie','RSC'])if(!vary.has(name.toLowerCase()))vary.set(name.toLowerCase(),name);
 reply.header('Vary',vary.has('*')?'*':[...vary.values()].join(', '));
 const privateResponse=partialReplies.has(reply)||['x-api-key','authorization','cookie','rsc'].some(name=>request.headers[name]!==undefined)||reply.hasHeader('set-cookie');
 const json=/^application\/json(?:\s*;|$)/i.test(String(reply.getHeader('content-type')??''));
 const ttl=publicV1Ttl(path),shareable=['GET','HEAD'].includes(request.method)&&reply.statusCode>=200&&reply.statusCode<300&&json&&ttl>0&&!vary.has('*');
 reply.header('Cache-Control',privateResponse?'private, no-store':shareable?`public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl*2}`:'no-store');
 return true;
}
export function registerPublicV1Cache(app:FastifyInstance){
 app.addHook('onSend',async(request,reply,payload)=>{applyPublicV1Cache(request,reply);return payload;});
}
