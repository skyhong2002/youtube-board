import {readFile} from 'node:fs/promises';
import {describe,it,expect,vi} from 'vitest';
import type {FastifyInstance,FastifyServerOptions} from 'fastify';
const captured=vi.hoisted(()=>new WeakMap<object,Set<string>>());
vi.mock('fastify',async importOriginal=>{
 const actual=await importOriginal<typeof import('fastify')>();
 return {...actual,default:(options?:FastifyServerOptions)=>{const app=actual.default(options),routes=new Set<string>();captured.set(app,routes);app.addHook('onRoute',route=>{for(const method of Array.isArray(route.method)?route.method:[route.method])if(method==='GET'&&(/^\/api\/v1(?:\/|$)/.test(route.url)||route.url==='/api/status'||/^\/api\/[^/]+\.php$/.test(route.url)))routes.add(route.url);});return app;}};
});
import Fastify from 'fastify';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {buildApp} from '../src/app.js';
import {legacyApiPaths} from '../src/legacy/index.js';
import {PUBLIC_ENDPOINTS,LEGACY_MAPPINGS,EXAMPLE_META,EXAMPLE_VIDEO_SOURCE,openApiPath} from '../src/public-api/catalog.js';
import {registerApiMetadata} from '../src/public-api/metadata.js';
import {buildOpenApi} from '../src/public-api/openapi.js';
import {SCHEMAS,ref} from '../src/public-api/schemas.js';
import {checkDocumentedExamples,responseValidator} from '../../tools/check-openapi.js';
import {renderApiDocs} from '../../tools/gen-api-docs.js';
import {openApiFields} from '../../shared/openapi-fields.js';
import type {ReportMeta} from '../src/contracts.js';
import type {Reader,Row} from '../src/db/client.js';
const clock=()=>new Date('2026-10-11T10:00:00Z');
function registerMissing(app:FastifyInstance){if(!app.hasRoute({method:'GET',url:'/api/v1'}))registerApiMetadata(app,{meta:()=>({...EXAMPLE_META} as ReportMeta)});}
describe('public catalog and OpenAPI contracts',()=>{
 it('covers actual Fastify onRoute GET registrations including all 36 legacy routes',async()=>{
  const app=buildApp({reader:{rows:async()=>[],close:async()=>{}},clock});registerMissing(app);
  try{await app.ready();expect([...captured.get(app)!].sort()).toEqual(PUBLIC_ENDPOINTS.filter(e=>e.path!=='/api/status').map(e=>e.path).sort());const status=await app.inject({url:'/api/status',headers:{Accept:'application/json'}});expect(status.statusCode).toBe(200);expect(status.json().scope).toBe('api_availability');expect(new Set(PUBLIC_ENDPOINTS.map(e=>e.path)).size).toBe(PUBLIC_ENDPOINTS.length);expect(new Set(PUBLIC_ENDPOINTS.map(e=>e.operationId)).size).toBe(PUBLIC_ENDPOINTS.length);expect(LEGACY_MAPPINGS).toHaveLength(36);expect(LEGACY_MAPPINGS.map(m=>m.path).sort()).toEqual([...legacyApiPaths].sort());}finally{await app.close();}
 });
 it('uses raw OpenAPI, the same catalog index and preserves old inventory semantics',async()=>{
  const app=buildApp({reader:{rows:async()=>[],close:async()=>{}},clock,dataset:'fixture'});registerMissing(app);
  try{const spec=await app.inject('/api/v1/openapi.json');expect(spec.statusCode).toBe(200);expect(spec.headers['content-type']).toContain('application/json');expect(spec.headers['cache-control']).toMatch(/(?:s-maxage|max-age)=3600/);expect(spec.json()).toMatchObject({openapi:'3.1.0',info:{title:'有影儀表板公開 API'}});expect(spec.json().data).toBeUndefined();const index=(await app.inject('/api/v1')).json();expect(index.data.endpoints.map((e:{path:string})=>e.path)).toEqual(PUBLIC_ENDPOINTS.map(e=>e.path));const old=(await app.inject('/api/v1/status')).json();expect(old.data.readOnly).toBe(true);expect(old.data.routes).toContain('/api/v1/videos');expect(old.data.status).toBeUndefined();}finally{await app.close();}
 });
 it('compiles every response schema and validates every documented example',()=>{expect(checkDocumentedExamples()).toBeGreaterThanOrEqual(4);const spec=buildOpenApi();for(const endpoint of PUBLIC_ENDPOINTS){expect(spec.paths[openApiPath(endpoint.path)]).toBeDefined();const names=[...endpoint.path.matchAll(/:([A-Za-z]+)/g)].map(m=>m[1]);expect(endpoint.parameters.filter(p=>p.in==='path').map(p=>p.name)).toEqual(names);if(endpoint.schemaCoverage==='envelope-only')expect(endpoint.schema).toBeUndefined();}expect(spec.components.securitySchemes.PersonalApiKey).toMatchObject({type:'apiKey',in:'header',name:'x-api-key'});for(const path of Object.values(spec.paths) as {get:{security:unknown}}[])expect(path.get.security).toEqual([{},{PersonalApiKey:[]}]);const cursorPaths=PUBLIC_ENDPOINTS.filter(e=>e.parameters.some(p=>p.name==='cursor')).map(e=>e.path).sort();expect(cursorPaths).toEqual(['/api/v1/channels/:id/videos','/api/v1/keywords/:keyword/videos','/api/v1/tags/:id/videos','/api/v1/tags/videos','/api/v1/videos']);for(const path of cursorPaths)expect(PUBLIC_ENDPOINTS.find(e=>e.path===path)!.schema).toBe('VideoCollection');});
 it('validates every array item, null totals and date-time formats, not just a sample',()=>{
  const endpoint=PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/videos')!,example=structuredClone(endpoint.example) as {data:{rows:Record<string,unknown>[];total:unknown};meta:Record<string,unknown>},validate=responseValidator(endpoint);
  example.data.rows=Array.from({length:61},()=>({...example.data.rows[0]}));expect(validate(example)).toBe(true);delete example.data.rows[60]!.title;expect(validate(example)).toBe(false);expect(validate.errors?.some(e=>e.instancePath==='/data/rows/60')).toBe(true);
  const invalid=structuredClone(endpoint.example) as typeof example;invalid.meta.requestedAt='tomorrow';expect(validate(invalid)).toBe(false);invalid.meta.requestedAt=EXAMPLE_META.requestedAt;invalid.data.total=-1;expect(validate(invalid)).toBe(false);
 });
 it('validates a nonempty video response through the actual HTTP handler and DTO normalizer',async()=>{
  const dialect=new MySqlDialect(),reader:Reader={rows:async<T extends Row>(query:Parameters<Reader['rows']>[0]):Promise<T[]>=>{const q=dialect.sqlToQuery(query).sql;if(q.includes('AS cutoff'))return [{cutoff:'2026-10-11 18:00:00',selected:1,nulls:0}] as unknown as T[];if(q.includes('FROM urt_video v')&&q.includes('ORDER BY'))return [{pk:990001,...EXAMPLE_VIDEO_SOURCE}] as unknown as T[];return [] as T[];},close:async()=>{}},app=buildApp({reader,clock,dataset:'fixture'});
  try{const response=await app.inject('/api/v1/videos?q=%E4%BA%A4%E9%80%9A');expect(response.statusCode).toBe(200);const body=response.json(),validate=responseValidator(PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/videos')!);expect(validate(body),JSON.stringify(validate.errors)).toBe(true);expect(body.data.rows[0]).toMatchObject({id:'FixtureAa01',title:'合成：城市交通規劃',views:200,comments:null});expect(body.data.rows[0].publishedAt).toBe('2026-10-11T10:00:00.000Z');expect(body.data.rows[0].updatedAt).toBe('2026-10-11T10:00:00.000Z');expect(body.data.nextCursor).toBeNull();expect(body.data.total).toBeNull();expect(body.data.totalStatus).toBe('not-computed');}finally{await app.close();}
 });
 it('generated docs are byte-for-byte current and include provenance, quota/cache and mappings',async()=>{const rendered=renderApiDocs();expect(await readFile(new URL('../../docs/api.md',import.meta.url),'utf8')).toBe(rendered);for(const expected of ['依 OpenAPI 規格產生','同一帳號所有金鑰合計每分鐘1000次','每人最多3把有效金鑰','累計最多建立100把','每個 IP 每分鐘60次','nextCursor 放入 cursor','24小時後過期','MIT License','觀測期間快照不代表完整標籤池','36支舊 PHP API 保留相容輸出','源站額度','一律為 UTC ISO 8601，以 Z 結尾','相容性變更紀錄','時間戳統一改為 UTC（破壞性變更）'])expect(rendered).toContain(expected);expect(rendered).not.toContain('可能為 UTC（Z）或台北偏移');});
 it('requires UTC Z instants, documents nextCursor and excludes private capabilities',()=>{
  const endpoint=PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/videos')!,validate=responseValidator(endpoint),example=structuredClone(endpoint.example) as {data:{rows:Record<string,unknown>[]}};
  for(const time of ['2026-10-11T10:00:00.000Z','2026-10-11T10:00:00Z']){example.data.rows[0]!.publishedAt=time;expect(validate(example),JSON.stringify(validate.errors)).toBe(true);}
  for(const time of ['2026-10-11T18:00:00+08:00','2026-10-11T10:00:00+00:00','not-a-date','2026-10-11 18:00:00','2026-10-11T18:00:00']){example.data.rows[0]!.publishedAt=time;expect(validate(example)).toBe(false);}
  expect(PUBLIC_ENDPOINTS.some(e=>/\/(auth|ops)(\/|$)|api-keys/.test(e.path))).toBe(false);
  expect(SCHEMAS.VideoCollection).toHaveProperty('properties.nextCursor');
 });
 it('validates additive F2 evidence without coercing unknown views',()=>{
  const endpoint=PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/videos')!,validate=responseValidator(endpoint),example=structuredClone(endpoint.example) as {data:{rows:Record<string,unknown>[]}};
  const row=example.data.rows[0]!;row.views=null;row.keywordEvidence=[{term:'交通',field:'title',snippet:'城市交通規劃',start:2,end:4,snippetStart:0}];
  expect(validate(example),JSON.stringify(validate.errors)).toBe(true);expect(row.views).toBeNull();
  row.keywordEvidence=Array(4).fill((row.keywordEvidence as unknown[])[0]);expect(validate(example)).toBe(false);
  row.keywordEvidence=[{term:'交通',field:'invented',snippet:'城市交通規劃',start:2,end:4,snippetStart:0}];expect(validate(example)).toBe(false);
 });
 it('shared field traversal resolves refs and terminates recursive schemas',()=>{const fields=openApiFields(ref('VideoCollection'),SCHEMAS);expect(fields).toContainEqual(expect.objectContaining({path:'rows[].publishedAt',type:'string | null',required:true}));expect(openApiFields(ref('Loop'),{Loop:{type:'object',properties:{next:ref('Loop')}}})).toContainEqual(expect.objectContaining({path:'next',type:'recursive reference'}));});
 it('standalone registration does not require auth, provider probes or a database URL',async()=>{const app=Fastify();registerApiMetadata(app,{meta:()=>({...EXAMPLE_META} as ReportMeta)});try{expect((await app.inject('/api/v1')).statusCode).toBe(200);}finally{await app.close();}});
});
