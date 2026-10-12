import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Ajv2020,type ValidateFunction} from 'ajv/dist/2020.js';
import {PUBLIC_ENDPOINTS,type Endpoint} from '../api/src/public-api/catalog.js';
import {SCHEMAS} from '../api/src/public-api/schemas.js';
import {successSchema} from '../api/src/public-api/openapi.js';
const require=createRequire(import.meta.url);
const ajv=new Ajv2020({strict:false,allErrors:true,validateFormats:true});
(require('ajv-formats') as (instance:Ajv2020)=>void)(ajv);
const validators=new Map<string,ValidateFunction>();
export function responseValidator(endpoint:Endpoint):ValidateFunction{
 let validate=validators.get(endpoint.path);if(!validate){validate=ajv.compile({$schema:'https://json-schema.org/draft/2020-12/schema',...successSchema(endpoint),components:{schemas:SCHEMAS}});validators.set(endpoint.path,validate);}return validate;
}
export function checkDocumentedExamples(){
 let checked=0;
 for(const endpoint of PUBLIC_ENDPOINTS){const validate=responseValidator(endpoint);if(endpoint.example!==undefined){if(!validate(endpoint.example))throw new Error(`${endpoint.path}: ${ajv.errorsText(validate.errors)}`);checked++;}}
 if(checked===0)throw new Error('Catalog has no validated response examples');
 return checked;
}
export async function checkRemote(base:string){
 const origin=new URL(base);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Explicit base URL must be an HTTP(S) origin without credentials');
 const paths=['/api/v1/videos','/api/v1/channels','/api/v1/vocabulary','/api/status'];
 for(const path of paths){const endpoint=PUBLIC_ENDPOINTS.find(e=>e.path===path)!,url=new URL(path,origin);if(path!=='/api/status')url.searchParams.set('limit','1');const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`);const validate=responseValidator(endpoint);if(!validate(await response.json()))throw new Error(`${path}: ${ajv.errorsText(validate.errors)}`);}
 return paths.length;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const index=process.argv.indexOf('--base-url');if(index!==-1&&!process.argv[index+1])throw new Error('--base-url requires an explicit origin');
 const examples=checkDocumentedExamples(),remote=index===-1?0:await checkRemote(process.argv[index+1]!);
 console.log(JSON.stringify({schemas:PUBLIC_ENDPOINTS.length,examples,remoteRequests:remote}));
}
