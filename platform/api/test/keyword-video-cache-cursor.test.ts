import {it,expect} from 'vitest';
import {reports} from '../src/reports/service.js';
import type {Reader,Row} from '../src/db/client.js';
import {encodeVideoCursor,videoFilterDigest,VIDEO_CURSOR_MAX_AGE_MS} from '../src/public-api/cursor.js';
it('does not let a cached cursor page bypass token expiration',async()=>{
 const anchor=new Date('2036-05-12T04:00:00Z');let now=new Date(+anchor+VIDEO_CURSOR_MAX_AGE_MS-1),reads=0;
 const reader:Reader={async rows<T extends Row>(){reads++;return [] as T[];},async close(){}};
 const service=reports(reader,()=>now);
 const filters=videoFilterDigest({scope:'general',column:'publishedAt',channelId:null,channelIds:[],all:[],any:[],not:[],term:null,from:null,to:null,since:null,until:null,rankingPool:null,hours:null,min:null,days:null,keyword:'AI'});
 const cursor=encodeVideoCursor({v:1,publishedAt:null,pk:'1',maxPk:'1',anchor:anchor.toISOString(),filters,vocabulary:null});
 await service.videos({keyword:'AI',cursor});expect(reads).toBe(1);
 now=new Date(+now+2);
 await expect(service.videos({keyword:'AI',cursor})).rejects.toThrow();expect(reads).toBe(1);
});
