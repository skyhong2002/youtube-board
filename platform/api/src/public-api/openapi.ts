import {API_INTRO,API_VERSION,PUBLIC_ENDPOINTS,openApiPath,responseSchema,type Endpoint} from './catalog.js';
import {SCHEMAS,envelope,ref,type Schema} from './schemas.js';
const rateHeaders={
 'x-ratelimit-limit':{description:'Origin quota per minute.',schema:{type:'integer'}},
 'x-ratelimit-remaining':{description:'Origin quota remaining when this response was created; shared cache may replay this snapshot.',schema:{type:'integer'}},
 'x-ratelimit-reset':{description:'Origin quota reset as Unix seconds; shared cache may replay this snapshot.',schema:{type:'integer'}},
};
export function successSchema(endpoint:Endpoint):Schema{
 if(endpoint.wire==='openapi')return {type:'object',required:['openapi','info','paths'],properties:{openapi:{const:'3.1.0'},info:{type:'object'},paths:{type:'object'}},additionalProperties:true};
 if(endpoint.wire&&endpoint.wire!=='json')return {type:'string'};
 if(endpoint.tag==='legacy')return {};
 if(endpoint.path==='/api/status')return responseSchema(endpoint);
 return envelope(responseSchema(endpoint));
}
export function buildOpenApi(options:{buildId?:string}={}){
 const paths:Record<string,unknown>={};
 for(const endpoint of PUBLIC_ENDPOINTS){
  const media=endpoint.wire==='text'?'text/plain':endpoint.wire==='html'?'text/html':endpoint.wire==='csv'?'text/csv':'application/json';
  const responses:Record<string,unknown>={'200':{description:endpoint.schemaCoverage==='envelope-only'?'Report envelope; route-specific data schema is not yet specified.':'Successful response.',headers:rateHeaders,content:{[media]:{schema:successSchema(endpoint),...(endpoint.example===undefined?{}:{example:endpoint.example})}}}};
  for(const [status,description] of [['400','Invalid query or cursor.'],['404','Requested record not found.'],['409','Source state changed; retry from a fresh read.'],['422','Bounded report read exceeds available capacity.'],['429','Origin quota exceeded.'],['500','Unexpected query/schema failure.'],['501','Report not implemented.'],['503','Data source unavailable.']])responses[status!]={description,headers:status==='429'?{'Retry-After':{schema:{type:'integer'},description:'Seconds until the next permitted request.'}}:{},content:{'application/json':{schema:endpoint.path==='/api/status'&&status==='503'?{anyOf:[ref('ApiAvailability'),ref('ApiError')]}:endpoint.tag==='legacy'?{anyOf:[ref('LegacyApiError'),ref('ApiError')]}:ref('ApiError')}}};
  paths[openApiPath(endpoint.path)]={get:{operationId:endpoint.operationId,tags:[endpoint.tag],summary:endpoint.summary,description:endpoint.description,parameters:endpoint.parameters,deprecated:endpoint.deprecated??false,security:[{}, {PersonalApiKey:[]}],responses,'x-schema-coverage':endpoint.schemaCoverage}};
 }
 return {openapi:'3.1.0',jsonSchemaDialect:'https://json-schema.org/draft/2020-12/schema',info:{title:'有影儀表板公開 API',version:API_VERSION,description:API_INTRO,...(options.buildId?{'x-build-id':options.buildId}:{})},servers:[{url:'https://youtube.observe.tw'}],tags:[...new Set(PUBLIC_ENDPOINTS.map(e=>e.tag))].map(name=>({name})),paths,components:{schemas:SCHEMAS,securitySchemes:{PersonalApiKey:{type:'apiKey',in:'header',name:'x-api-key',description:'Optional personal read-quota key. Invalid/revoked keys use the anonymous allowance; this is not session or ops authorization.'}}}};
}
