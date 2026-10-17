/** Fixed same-origin development bridge. Production Fastify owns these routes. */
export function privateRoute(path:string,method:string){
 if(path==='/auth/google'||path==='/auth/google/callback'||path==='/auth/me'||path==='/auth/users'||path==='/auth/admin/user-activity'||path==='/auth/admin/channels')return method==='GET';
 if(path==='/auth/logout')return method==='POST';
 if(/^\/auth\/users\/[1-9]\d{0,15}\/role$/.test(path))return method==='PUT'&&Number.isSafeInteger(Number(path.split('/')[3]));
 if(/^\/auth\/me\/(follows|saves)$/.test(path))return ['GET','PUT'].includes(method);
 if(path==='/auth/me/feed')return method==='GET';
 if(path==='/auth/me/feed-token')return ['GET','POST','DELETE'].includes(method);
 if(/^\/feeds\/u\/[A-Za-z0-9_-]{43}\.xml$/.test(path))return method==='GET';
 if(['/api/ops/ingestion','/api/ops/ingestion/history','/api/ops/workflows'].includes(path))return method==='GET';
 if(/^\/api\/ops\/workflows\/jobs\/[a-f0-9]{64}$/.test(path)||/^\/api\/ops\/ingestion\/runs\/[A-Za-z0-9_-]{1,100}$/.test(path))return method==='GET';
 if(/^\/api\/ops\/(ingestion|workflows)\/(preview|run)$/.test(path))return method==='POST';
 if(path==='/api/ops/editorial'||/^\/api\/ops\/editorial\/events\/[0-9a-f-]{36}$/.test(path))return method==='GET';
 if(/^\/api\/ops\/editorial\/(preview|execute)$/.test(path))return method==='POST';
 // Keyword review: session-admin only. Exact status/list/detail reads, preview/execute writes and one-click ranking-display decisions.
 if(path==='/api/ops/keyword-reviews'||path==='/api/ops/keyword-reviews/status'||/^\/api\/ops\/keyword-reviews\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(path))return method==='GET';
 if(/^\/api\/ops\/keyword-reviews\/(preview|execute)$/.test(path))return method==='POST';
 if(path==='/api/ops/keyword-reviews/ranking-display')return method==='GET'||method==='POST';
 return false;
}
const privateHeaders={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
async function boundedBody(body:ReadableStream<Uint8Array>|null,limit:number){if(!body)return new Uint8Array();const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>limit){await reader.cancel();throw new Error('BODY_LIMIT');}chunks.push(item.value);}}finally{reader.releaseLock();}const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;}
export async function privateProxy(request:Request,options:{base?:string;fetcher?:typeof fetch}={}){
 const requested=new URL(request.url),method=request.method;
 if(!privateRoute(requested.pathname,method))return Response.json({error:{code:'NOT_FOUND'}},{status:404,headers:privateHeaders});
 const base=new URL(options.base??process.env.YOUTUBE_API_BASE_URL??'http://127.0.0.1:4100/api/v1');
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password)return Response.json({error:{code:'AUTH_UNAVAILABLE'}},{status:503,headers:privateHeaders});
 const headers=new Headers({Accept:request.headers.get('accept')??'application/json'});
 // No forwarded-host/address trust, and never forward cookies to a public API or Google.
 for(const key of ['cookie','origin','sec-fetch-site','x-csrf-token','content-type']){const value=request.headers.get(key);if(value)headers.set(key,value);}
 if(request.headers.has('authorization'))headers.set('authorization',request.headers.get('authorization')!); // Preserve presence: API rejects mixed credential modes, even an empty header.
 let body:Uint8Array|undefined;try{if(!['GET','HEAD'].includes(method))body=await boundedBody(request.body,16384);}catch{return Response.json({error:{code:'BODY_LIMIT'}},{status:413,headers:privateHeaders});}
 try{
  const upstream=await(options.fetcher??fetch)(new URL(requested.pathname+requested.search,base.origin),{method,headers,...(body?.length?{body:Buffer.from(body)}:{}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});
  const output=new Headers(privateHeaders);for(const key of ['content-type','location','retry-after']){const value=upstream.headers.get(key);if(value)output.set(key,value);}
  for(const cookie of upstream.headers.getSetCookie())output.append('set-cookie',cookie);
  const payload=await boundedBody(upstream.body,2*1024*1024);
  return new Response([204,205,304].includes(upstream.status)?null:payload,{status:upstream.status,headers:output});
 }catch{return Response.json({error:{code:'AUTH_UNAVAILABLE'}},{status:503,headers:privateHeaders});}
}
