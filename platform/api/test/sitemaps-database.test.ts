import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import mysql,{type Connection,type RowDataPacket} from 'mysql2/promise';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import type {Reader} from '../src/db/client.js';
import {createSitemaps} from '../src/seo/sitemaps.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
const NOW=Date.parse('2026-10-12T12:00:00Z');
describe.skipIf(!url)('prepared sitemap snapshots on isolated real MariaDB schema',()=>{
 const prefix='seo_'+randomBytes(5).toString('hex')+'_',names=['urt_channel','urt_video','urt_tag'];
 const created:string[]=[],queries:Array<{sql:string;params:unknown[]}>=[];
 const replace=(statement:string)=>statement.replace(new RegExp('\\b('+names.join('|')+')\\b','g'),name=>prefix+name);
 const dialect=new MySqlDialect();let db:Connection;
 const reader:Reader={async rows(statement){const query=dialect.sqlToQuery(statement);queries.push(query);const[rows]=await db.query<RowDataPacket[]>(replace(query.sql),query.params);return rows as never;},async close(){}};
 beforeAll(async()=>{
  db=await mysql.createConnection({uri:url!,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,timezone:'+08:00'});
  const ddl=await readFile(new URL('../../../database/schema/legacy-dashboard-baseline.sql',import.meta.url),'utf8');
  for(const name of names){const definition=new RegExp('CREATE TABLE IF NOT EXISTS `?'+name+'`? \\([\\s\\S]*?\\) ENGINE=[^;]+;').exec(ddl)?.[0];if(!definition)throw new Error('Missing checked-in sitemap schema');await db.query(replace(definition));created.push(name);}
  await db.query(replace("INSERT INTO urt_channel(u_id,ctime,mtime,stime,flag_del,youtube_id,title) VALUES(1,'2026-10-01','2026-10-11 12:00:00','2027-10-01',0,'UCfixtureA','Active'),(2,'2026-10-01','2026-10-11',NULL,1,'UCfixtureB','Deleted'),(60000001,'2026-10-01','2026-10-11',NULL,NULL,'UCfixtureC','Sparse')"));
  await db.query(replace("INSERT INTO urt_tag(tag_id,ctime,mtime,tag_name,del_flag) VALUES(1,'2026-10-01','2026-10-11 12:00:00','公開分類',0),(2,'2026-10-01','2026-10-11','已刪分類',1)"));
  for(const[pk,id,title]of[[1,'SitemapAa01','Public A'],[60000001,'Sitemapaa01','Public a'],[60000002,'SitemapPr01','Private video'],[60000003,'SitemapDe01','Deleted video']]as const)await db.query(replace("INSERT INTO urt_video(pk,ctime,mtime,stime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description) VALUES(?,'2026-10-01','2026-10-11 12:00:00','2027-10-01',1,?,'2026-10-01','UCfixtureA',?,'','Fixture','fixture',0,?,'')"),[pk,id,title,id]);
 });
 afterAll(async()=>{try{for(const name of [...created].reverse())await db.query('DROP TABLE `'+prefix+name+'`');}finally{await db?.end();}});
 it('prepares only nonempty mandatory families using real source columns, sparse keysets and truthful index dates',async()=>{
  const maps=createSitemaps(reader,{now:()=>NOW,staticLastModified:'2026-10-12T00:00:00Z',batchSize:1});await maps.prepare();
  const index=await maps.read();expect(index.match(/<sitemap>/g)).toHaveLength(4);expect(index.match(/<lastmod>/g)).toHaveLength(4);expect(index).not.toContain('/keywords/');expect(index).not.toContain('/events/');
  const channels=await maps.read('channels','1');expect(channels).toContain('/channels/1<');expect(channels).toContain('/channels/60000001<');expect(channels).not.toContain('/channels/2<');
  const tags=await maps.read('tags','1');expect(tags).toContain('/tags/1/channels<');expect(tags).not.toContain('/tags/2/channels<');expect(tags).toContain('2026-10-11T04:00:00.000Z');
  const videos=await maps.read('videos','1');expect(videos).toContain('/videos/SitemapAa01<');expect(videos).toContain('/videos/Sitemapaa01<');expect(videos).not.toContain('SitemapPr01');expect(videos).not.toContain('SitemapDe01');expect(videos).not.toContain('2027');
  const count=queries.length;await maps.read();await maps.read('videos','1');await expect(maps.read('videos','1201')).rejects.toMatchObject({statusCode:404});expect(queries).toHaveLength(count);
 });
 it('EXPLAIN permits indexed PK ranges with one indexed byte-exact probe per video rather than global sort or OFFSET',async()=>{
  const batches=queries.filter(q=>q.sql.includes('cursor_id'));expect(batches.length).toBeGreaterThan(0);
  for(const query of batches){const[plan]=await db.query<RowDataPacket[]>('EXPLAIN '+replace(query.sql),query.params);expect(plan.length).toBeGreaterThan(0);expect(query.sql).not.toContain('OFFSET');expect(query.params.at(-1)).toBe(1);
   expect(plan.some(row=>String(row.possible_keys??row.key??'').includes('PRIMARY'))).toBe(true);
   if(query.sql.includes('FROM urt_video v')){const inner=plan.find(row=>row.table==='newer');expect(inner,JSON.stringify(plan)).toBeDefined();expect(inner!.key).toBe('videoId');expect(['eq_ref','ref','unique_subquery']).toContain(inner!.type);expect(String(inner!.ref)).toMatch(/(?:\.|^)v\.videoId$/);expect(Number(inner!.rows)).toBeLessThanOrEqual(1);}
  }
 });
 it('excludes old duplicate records before assigning sequential sitemap pages',async()=>{
  await db.query(replace('ALTER TABLE urt_video DROP INDEX videoId,ADD INDEX videoId(videoId)'));
  await db.query(replace("INSERT INTO urt_video(ctime,mtime,stime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description) SELECT ctime,'2026-10-12 12:00:00',stime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description FROM urt_video WHERE pk=1"));
  const maps=createSitemaps(reader,{now:()=>NOW,maxPageUrls:1});await maps.prepare();
  const first=await maps.read('videos','1'),second=await maps.read('videos','2');expect(first).toContain('/videos/Sitemapaa01<');expect(second).toContain('/videos/SitemapAa01<');expect(second).toContain('2026-10-12T04:00:00.000Z');await expect(maps.read('videos','3')).rejects.toMatchObject({statusCode:404});
 });
});
