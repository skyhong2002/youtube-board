import {it,expect} from 'vitest';
import {buildApp} from '../src/app.js';
import {LEGACY_MAPPINGS} from '../src/public-api/catalog.js';
import fixtures from './public-api-legacy-fixture.json' with {type:'json'};
/** Golden pre-catalog empty-source contracts. Existing populated MariaDB suites
 * cover source payload semantics; these lock every mapping's wire boundary. */
it('preserves status, complete body and compatibility headers for all 36 legacy mappings',async()=>{
 const app=buildApp({reader:{rows:async()=>[],close:async()=>{}},clock:()=>new Date('2026-10-11T10:00:00Z'),dataset:'fixture'});
 try{expect(fixtures).toHaveLength(36);expect(fixtures.map(f=>f.url.split('?')[0]).sort()).toEqual(LEGACY_MAPPINGS.map(m=>m.path).sort());for(const fixture of fixtures){const response=await app.inject(fixture.url);expect(response.statusCode,fixture.url).toBe(fixture.status);expect(response.headers,fixture.url).toMatchObject(fixture.headers);const body=String(response.headers['content-type']).includes('application/json')?response.json():response.body;expect(body,fixture.url).toEqual(fixture.body);}}finally{await app.close();}
});
