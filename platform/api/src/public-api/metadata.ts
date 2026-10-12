import type {FastifyInstance} from 'fastify';
import type {ReportMeta} from '../contracts.js';
import {API_VERSION,PUBLIC_ENDPOINTS} from './catalog.js';
import {buildOpenApi} from './openapi.js';
export interface ApiMetadataOptions {meta:()=>ReportMeta;buildId?:string}
/** Register before the gateway UI proxy. Does not install response serializers. */
export function registerApiMetadata(app:FastifyInstance,options:ApiMetadataOptions){
 const spec=buildOpenApi({buildId:options.buildId});
 const endpoints=PUBLIC_ENDPOINTS.map(({method,path,operationId,tag,summary,schemaCoverage})=>({method,path,operationId,tag,summary,schemaCoverage}));
 app.get('/api/v1',async(_request,reply)=>{reply.header('Cache-Control','public, max-age=3600');return {data:{name:'有影儀表板公開 API',version:API_VERSION,docs:'/api',openapi:'/api/v1/openapi.json',endpoints},meta:options.meta()};});
 app.get('/api/v1/openapi.json',async(_request,reply)=>{reply.header('Cache-Control','public, max-age=3600').type('application/json; charset=utf-8');return spec;});
}
