import {it,expect,describe,beforeAll,afterAll} from 'vitest';
import mysql,{type ResultSetHeader} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {analyzeAuthorComments,authorIndex} from '../src/reports/author-analysis.js';
import {buildApp} from '../src/app.js';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
it('author hours use Taipei and preserve nested replies exactly once, invalid dates separately',()=>{
 const result=analyzeAuthorComments([{videoId:'AuthorAa001',u_id:4,comments_json:JSON.stringify({one:{authorChannelId:{value:'UCauthor'},publishedAt:'2026-10-11T17:03:00Z',textOriginal:' <b>root</b> ',replies:[{authorChannelId:'UCauthor',publishedAt:'2026-10-11T00:04:00Z',textOriginal:'reply'}]},two:{authorChannelId:'UCother',replies:{r:{authorChannelId:'UCauthor',publishedAt:'invalid',textOriginal:'undated'}}}})},{videoId:'Authoraa001',u_id:4,comments_json:'{}'}],'UCauthor');
 expect(result.hourly).toHaveLength(24);expect(result.hourly[1]).toMatchObject({comments:1,replies:0,total:1});expect(result.hourly[8]).toMatchObject({comments:0,replies:1,total:1});expect(result.comments).toHaveLength(3);expect(result.comments.find(c=>!c.reply)?.text).toBe('root');expect(result).toMatchObject({roots:1,replies:2,undated:1});expect(result.channels).toEqual([{uId:4,videos:2,comments:1,replies:2,total:3}]);
});
it('author index accepts writer lists, trims PHP whitespace and documents key/count extension',()=>{
 expect(authorIndex(JSON.stringify([' AuthorAa001 ',123,'invalid video',null]))).toMatchObject({ids:['AuthorAa001','123','3'],ignoredEntries:1,keyCountMap:false});
 expect(authorIndex(JSON.stringify({AuthorAa001:3,anything:'2026-10-11 01:00:00',id:' Authoraa001 ',other:{}}))).toEqual({ids:['AuthorAa001','Authoraa001','other'],keyCountMap:true,ignoredEntries:1});
});
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('author report real MariaDB aggregates',()=>{
 let db:mysql.Connection,authorId:number,uId:number,otherId:number;
 const token=randomUUID().replaceAll('-','').slice(0,8),identity='UCauthor_'+token,ids=['Aa','aa','Bb','Cc'].map(s=>'A'+token+s),app=buildApp({databaseUrl:url,dataset:'fixture'});
 beforeAll(async()=>{
  db=await mysql.createConnection(url!);const stamp='2026-10-11 18:00:00';
  const [a]=await db.execute<ResultSetHeader>('INSERT INTO urt_comment_author(ctime,ChannelId,DisplayName,ChannelUrl,ImageUrl) VALUES(?,?,?,?,?)',[stamp,identity,'合成作者','','']);authorId=a.insertId;
  const [c]=await db.execute<ResultSetHeader>('INSERT INTO urt_channel(ctime,youtube_id,title) VALUES(?,?,?)',[stamp,'UCchannel_'+token,'合成來源']);uId=c.insertId;
  const [other]=await db.execute<ResultSetHeader>('INSERT INTO urt_channel(ctime,youtube_id,title) VALUES(?,?,?)',[stamp,'UCother_'+token,'另一來源']);otherId=other.insertId;
  await db.execute('INSERT INTO urt_count(u_id,ctime,tags)VALUES(?,?,?)',[uId,stamp,'[3][3][4][99999]']);
  await db.execute('INSERT INTO urt_count(u_id,ctime,tags)VALUES(?,?,?)',[otherId,stamp,'[3]']);
  await db.execute('INSERT INTO urt_comment_rev(author_id,ctime,index_json)VALUES(?,?,?)',[authorId,stamp,JSON.stringify([ids[0],ids[2],ids[3]])]);
  const item={authorChannelId:identity,publishedAt:'2026-10-11T17:00:00Z',textOriginal:'root',replies:[{authorChannelId:{value:identity},publishedAt:'2026-10-11T00:00:00Z',textOriginal:'reply'}]};
  for(let i=0;i<4;i++)await db.execute('INSERT INTO urt_comment(ctime,mtime,u_id,videoId,pageToken,comments_json)VALUES(?,?,?,?,?,?)',[stamp,stamp,i===2?otherId:uId,ids[i],i===3?'pending':'',JSON.stringify(i===2?{}:{root:item})]);
 });
 afterAll(async()=>{await app.close();if(db){for(const id of ids)await db.execute('DELETE FROM urt_comment WHERE BINARY videoId=BINARY ?',[id]);if(authorId){await db.execute('DELETE FROM urt_comment_rev WHERE author_id=?',[authorId]);await db.execute('DELETE FROM urt_comment_author WHERE author_id=?',[authorId]);}for(const id of [uId,otherId].filter(Boolean)){await db.execute('DELETE FROM urt_count WHERE u_id=?',[id]);await db.execute('DELETE FROM urt_channel WHERE u_id=?',[id]);}await db.end();}});
 it('matches indexed byte-exact IDs, excludes pending batches, aggregates whole history independent of page',async()=>{
  const response=await app.inject('/api/v1/comments/authors/'+authorId+'?limit=1&offset=1&hours=1');expect(response.statusCode,response.body).toBe(200);const d=response.json().data;
  expect(d.total).toBe(2);expect(d.rows).toHaveLength(1);expect(d.metrics.find((m:any)=>m.label==='完整擷取批次').value).toBe(2);
  expect(d.sections[0].rows[1].total).toBe(1);expect(d.sections[0].rows[8].total).toBe(1);
  expect(d.sections[1].rows).toHaveLength(1);expect(d.sections[1].rows[0]).toMatchObject({videos:1,comments:1,replies:1,total:2});
  expect(d.sections[2].rows.map((r:any)=>[r.tag.href,r.videos])).toEqual([['/tags/3/channels',2],['/tags/4/channels',1]]);
 });
 it('supports explicit channel lookup aliases and preserves identity case',async()=>{
  expect((await app.inject('/api/v1/comments/authors/'+identity+'?lookup=channel_id')).statusCode).toBe(200);
  expect((await app.inject('/api/v1/comments/authors/'+identity.toUpperCase()+'?lookup=ChannelId')).statusCode).toBe(404);
  for(const query of ['lookup=bad','lookup=author','hours=8761','limit=201'])expect((await app.inject('/api/v1/comments/authors/'+identity+'?'+query)).statusCode).toBe(400);
 });
});
