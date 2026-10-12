import {writeFileSync,readFileSync} from 'node:fs';
import {PUBLIC_ENDPOINTS} from '../api/src/public-api/catalog.js';
import {publicV1Ttl} from '../api/src/public-v1-cache.js';
const eligible=PUBLIC_ENDPOINTS.filter(e=>(e.path==='/api/v1'||e.path.startsWith('/api/v1/'))&&publicV1Ttl(e.path)>0&&(!e.wire||['json','openapi'].includes(e.wire)));
const exactPaths=eligible.filter(e=>!e.path.includes(':')).map(e=>({path:e.path,sMaxAge:publicV1Ttl(e.path)})).sort((a,b)=>a.path.localeCompare(b.path));
const out={generatedBy:'tools/gen-api-cache-allowlist.ts; do not edit',host:'youtube.observe.tw',method:'GET',query:'must be empty',excludedRequestHeaders:['cookie','authorization','x-api-key','x-service-token','rsc'],originPolicy:'Respect Cache-Control. Never override private/no-store/Set-Cookie, errors or non-JSON. Do not force TTL.',exactPaths,parameterizedExcluded:eligible.filter(e=>e.path.includes(':')).map(e=>e.path).sort()};
const path=new URL('../docs/cloudflare-api-cache-allowlist.json',import.meta.url),body=JSON.stringify(out,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==body)throw new Error('API cache allowlist is stale');}else writeFileSync(path,body);
console.log(JSON.stringify({exactPaths:exactPaths.length,parameterizedExcluded:out.parameterizedExcluded.length}));
