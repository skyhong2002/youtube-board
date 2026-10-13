import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {AuthRuntime} from '../auth/types.js';
import {ReviewError,fail,parseCommand} from './domain.js';
import {executeReview,previewReview,type ReviewRepository} from './repository.js';
export interface KeywordReviewOptions {auth?:AuthRuntime;env?:NodeJS.ProcessEnv;keywordReviewRepository?:ReviewRepository;clock?:()=>Date}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Deliberately session-only: existing ops bearer authority never grants review access. */
export async function registerKeywordReviewOps(app:FastifyInstance,options:KeywordReviewOptions={}) {
 const env=options.env??process.env,repo=options.keywordReviewRepository,actors=new WeakMap<FastifyRequest,string>(),clock=options.clock??(()=>new Date());
 const enabled=()=>env.TS_KEYWORD_REVIEW_ENABLED==='true';
 const writable=()=>enabled()&&env.TS_KEYWORD_REVIEW_WRITE_ENABLED==='true';
 const available=async()=>{if(!enabled())return fail('KEYWORD_REVIEW_DISABLED',503);if(!repo||!await repo.ready())return fail('KEYWORD_REVIEW_SCHEMA_UNAVAILABLE',503);return repo;};
 await app.register(async routes=>{
  const privacy=(reply:import('fastify').FastifyReply)=>reply.header('Cache-Control','private, no-store').header('X-Robots-Tag','noindex').header('Vary','Cookie').header('Referrer-Policy','no-referrer');
  routes.addHook('onSend',async(_req,reply,payload)=>{privacy(reply);return payload;});
  routes.addHook('onRequest',async(req,reply)=>{
   privacy(reply);
   if(!options.auth){reply.header('Cache-Control','private, no-store').header('X-Robots-Tag','noindex');return reply.code(503).send({error:{code:'AUTH_DISABLED'}});}
   const user=await options.auth.requireAdmin(req,reply,!['GET','HEAD'].includes(req.method));if(!user)return reply;
   actors.set(req,options.auth.actor(user));
  });
  routes.setErrorHandler((error,_req,reply)=>{
   if(error instanceof ReviewError)return reply.code(error.status).send({error:{code:error.code}});
   // Never include SQL, connection details, evidence or raw exception messages.
   const code=(error as {code?:unknown})?.code;
   if(code==='ER_DUP_ENTRY')return reply.code(409).send({error:{code:'REVIEW_CONFLICT'}});
   return reply.code(503).send({error:{code:'KEYWORD_REVIEW_UNAVAILABLE'}});
  });
  routes.get('/api/ops/keyword-reviews/status',async()=>{
   const schemaReady=enabled()&&!!repo&&await repo.ready();
   return {enabled:enabled(),writeEnabled:writable(),schemaReady,status:!enabled()?'disabled':!schemaReady?'schema-unavailable':'ready',phase:'review-record-only',applied:false,applicationStatus:'not-applied',rankingOverlayEnabled:false};
  });
  routes.get<{Querystring:{page?:string;version?:string}}>('/api/ops/keyword-reviews',async req=>{
   const page=Number(req.query.page??1),version=req.query.version;
   if(!Number.isSafeInteger(page)||page<1||page>1000||(version!==undefined&&!/^[A-Za-z0-9_-]{1,100}$/.test(version)))return fail('INVALID_REVIEW_QUERY');
   const db=await available();return {...await db.list(page,version),applied:false,applicationStatus:'not-applied'};
  });
  routes.get<{Params:{id:string}}>('/api/ops/keyword-reviews/:id',async req=>{
   if(!idPattern.test(req.params.id))return fail('INVALID_REVIEW_ID');
   const db=await available(),detail=await db.detail(req.params.id);if(!detail)return fail('REVIEW_NOT_FOUND',404);return detail;
  });
  for(const mode of ['preview','execute'] as const)routes.post('/api/ops/keyword-reviews/'+mode,{bodyLimit:16384},async req=>{
   const actor=actors.get(req);if(!actor)return fail('ADMIN_ACTOR_REQUIRED',403);
   if(!object(req.body)||Object.keys(req.body).some(k=>!['command',...(mode==='execute'?['previewHash','execute']:[])].includes(k)))return fail('INVALID_REVIEW_REQUEST');
   const command=parseCommand(req.body.command),db=await available();
   if(mode==='preview')return {mode,...await previewReview(db,command,actor,clock().toISOString())};
   if(!writable()||req.body.execute!==true)return fail('KEYWORD_REVIEW_WRITE_DISABLED',403);
   return {mode,...await executeReview(db,command,actor,String(req.body.previewHash??''),clock().toISOString())};
  });
 });
}
