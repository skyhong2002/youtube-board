import type {AuthRuntime} from '../auth/index.js';
import {AuthStoreFailure} from '../auth/store.js';
import type {FastifyRequest} from 'fastify';
import type {FastifyInstance} from 'fastify';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import {authorizeOps} from './auth.js';
import {connectEditorialDatabase} from '../db/frontend.js';
import {assertExecute,executionPolicy} from '../../../jobs/src/policy.js';
import {actorFrom,EditorialError,object,uuid} from '../../../shared/editorial/contracts.js';
import {editorialTransaction,eventState,inspectEditorial,planEditorial} from '../../../shared/editorial/service.js';
export interface EditorialOptions {auth?:AuthRuntime;env?:NodeJS.ProcessEnv;editorialConnect?:(env:NodeJS.ProcessEnv)=>Promise<Connection>}
export async function registerEditorialOps(app:FastifyInstance,options:EditorialOptions={}){
 const env=options.env??process.env,connect=options.editorialConnect??connectEditorialDatabase,actors=new WeakMap<FastifyRequest,string>();
 await app.register(async ops=>{
  ops.addHook('onRequest',async(req,reply)=>{
   if(req.headers.authorization!==undefined||!options.auth?.enabled){if(!authorizeOps(env,req,reply))return reply;const label=actorFrom(env);if(label.length>92)throw new EditorialError('ACTOR_NOT_CONFIGURED',503);actors.set(req,'service:'+label);return;}
   const user=await options.auth.requireAdmin(req,reply,!['GET','HEAD'].includes(req.method));if(!user)return reply;actors.set(req,options.auth.actor(user));
  });
  ops.setErrorHandler((error,_req,reply)=>{if(error instanceof AuthStoreFailure)return reply.code(503).send({error:{code:'AUTH_UNAVAILABLE'}});if(error instanceof EditorialError)return reply.code(error.status).send({error:{code:error.code}});if(error&&typeof error==='object'&&'statusCode' in error&&typeof error.statusCode==='number'&&error.statusCode>=400&&error.statusCode<500)return reply.code(error.statusCode).send({error:{code:'INVALID_REQUEST'}});if(error instanceof Error&&error.message==='Another TypeScript writer holds this workflow')return reply.code(409).send({error:{code:'WRITER_BUSY'}});const code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'UNKNOWN';if(code==='ER_DUP_ENTRY')return reply.code(409).send({error:{code:'IDENTITY_CONFLICT'}});const unavailable=['ECONNREFUSED','ECONNRESET','ETIMEDOUT','PROTOCOL_CONNECTION_LOST','ER_ACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR','ER_LOCK_WAIT_TIMEOUT'].includes(code);process.stderr.write('youtube-board-editorial: request failed ['+code+']\n');return reply.code(unavailable?503:500).send({error:{code:unavailable?'EDITORIAL_UNAVAILABLE':'EDITORIAL_FAILED'}});});
  ops.get<{Querystring:{page?:string}}>('/api/ops/editorial',async(req)=>{const db=await connect(env);try{return await inspectEditorial(db,Number(req.query.page??1));}finally{await db.end();}});
  ops.get<{Params:{id:string}}>('/api/ops/editorial/events/:id',async(req,reply)=>{if(!uuid(req.params.id))return reply.code(400).send({error:{code:'INVALID_ID'}});const db=await connect(env);try{const event=await eventState(db,req.params.id);if(!event)return reply.code(404).send({error:{code:'EVENT_NOT_FOUND'}});const[details]=await db.query<RowDataPacket[]>('SELECT s.id,s.kind,s.headline,s.source_id FROM ts_editorial_links l JOIN ts_editorial_sources s ON s.id=l.source_id WHERE l.event_id=? AND l.active=1 ORDER BY s.id LIMIT 500',[event.id]);return {...event,sourceDetails:details};}finally{await db.end();}});
  for(const mode of ['preview','execute'] as const)ops.post('/api/ops/editorial/'+mode,async(req,reply)=>{
   const actor=actors.get(req);if(!actor)throw new EditorialError('ACTOR_NOT_CONFIGURED',503);if(!object(req.body)||Object.keys(req.body).some(k=>!['command',...(mode==='execute'?['previewHash','execute']:[])].includes(k)))return reply.code(400).send({error:{code:'INVALID_REQUEST'}});
   if(mode==='execute'){
    const allow=new Set((env.TS_OPS_WRITE_ALLOWLIST??'').split(',').map(v=>v.trim()));
    try{if(req.body.execute!==true||env.TS_OPS_EXECUTION_ENABLED!=='true'||allow.has('*')||!allow.has('editorial.registry'))throw new Error();assertExecute('editorial.registry',executionPolicy(env,'execute'));}catch{return reply.code(403).send({error:{code:'EXECUTION_GATED'}});}
   }
   const db=await connect(env);try{
    if(mode==='preview'){const plan=await planEditorial(db,req.body.command,actor);return {mode,actor,previewHash:plan.previewHash,command:plan.command,before:plan.before,after:plan.after,warnings:plan.warnings,sources:plan.resolved.map(({snapshot,...s})=>s),writes:0,externalCalls:0};}
    return await editorialTransaction(db,req.body.command,actor,String(req.body.previewHash??''),undefined,true);
   }finally{await db.end();}
  });
 });
}
