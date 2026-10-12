import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,readdir,stat,symlink,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCrawlerLogSink,type CrawlerLogEntry} from '../src/seo/crawler-log-sink.js';

const temporary:string[]=[];
async function directory(){const dir=await mkdtemp(join(tmpdir(),'crawler-sink-test-'));temporary.push(dir);return dir;}
afterEach(async()=>{for(const dir of temporary.splice(0))await rm(dir,{recursive:true,force:true});});
const record=(n=0):CrawlerLogEntry=>({code:'CRAWLER_RESPONSE',at:'2026-10-13T00:00:00.000Z',method:'GET',path:'/robots.txt',status:200,bytes:n,userAgent:'Googlebot/2.1',cfRay:null,cfCountry:'TW',cfColo:'TPE',completed:true,verified:false});

describe('bounded persistent crawler log',()=>{
  it('persists safe JSONL with restrictive modes and survives reopen',async()=>{
    const dir=await directory(),sink=createCrawlerLogSink({directory:dir});
    sink.emit({...record(123),ip:'private',authorization:'private'} as unknown as CrawlerLogEntry);
    await sink.close();
    expect((await stat(dir)).mode&0o777).toBe(0o700);
    expect((await stat(join(dir,'crawler.jsonl'))).mode&0o777).toBe(0o600);
    const reopened=createCrawlerLogSink({directory:dir});
    reopened.emit(record(234));await reopened.close();
    const lines=(await readFile(join(dir,'crawler.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    expect(lines.map(line=>line.bytes)).toEqual([123,234]);expect(lines.map(line=>line.verified)).toEqual([false,false]);
    expect(lines[0]).not.toHaveProperty('ip');expect(lines[0]).not.toHaveProperty('authorization');
  });
  it('rotates within the file-count and byte caps across restarts',async()=>{
    const dir=await directory();
    for(let round=0;round<2;round++){
      const sink=createCrawlerLogSink({directory:dir,maxFileBytes:600,maxFiles:3,maxRecordBytes:300});
      for(let n=0;n<12;n++){sink.emit(record(n+round*12));await sink.flush();}
      await sink.close();
    }
    const files=(await readdir(dir)).filter(file=>file!=='crawler.lock');expect(files.sort()).toEqual(['crawler.jsonl','crawler.jsonl.1','crawler.jsonl.2']);
    let total=0;
    for(const file of files){const content=await readFile(join(dir,file));expect(content.byteLength).toBeLessThanOrEqual(600);total+=content.byteLength;for(const line of content.toString().trim().split('\n'))expect(()=>JSON.parse(line)).not.toThrow();}
    expect(total).toBeLessThanOrEqual(1800);
    expect((await readFile(join(dir,'crawler.jsonl'),'utf8'))).toContain('"bytes":23');
  });
  it('caps the asynchronous queue and rejects oversized records without throwing',async()=>{
    const sink=createCrawlerLogSink({directory:await directory(),maxQueueBytes:600,maxRecordBytes:300,onDiagnostic:()=>{}});
    for(let n=0;n<100;n++)sink.emit(record(n));
    expect(sink.stats().queuedBytes).toBeLessThanOrEqual(600);
    expect(sink.stats().dropped).toBeGreaterThanOrEqual(97);
    sink.emit({...record(),userAgent:'x'.repeat(1000)} as unknown as CrawlerLogEntry);
    await sink.close();expect(sink.stats().written).toBeGreaterThan(0);
    expect(sink.stats().queuedBytes).toBe(0);sink.emit(record());expect(sink.stats().dropped).toBeGreaterThanOrEqual(99);
  });
  it('rejects symlink files without touching the destination and reports only counts',async()=>{
    const dir=await directory(),outside=join(await directory(),'outside');await writeFile(outside,'untouched');
    await symlink(outside,join(dir,'crawler.jsonl'));
    const errors:unknown[]=[];const sink=createCrawlerLogSink({directory:dir,onDiagnostic:entry=>errors.push(entry)});
    expect(()=>sink.emit(record())).not.toThrow();await sink.close();
    expect(await readFile(outside,'utf8')).toBe('untouched');
    expect(errors).toEqual([{code:'CRAWLER_LOG_SINK_ERROR',count:1,dropped:1}]);expect(sink.stats().dropped).toBe(1);
  });
  it('fails safely on symlink directories, bad paths and oversized preexisting files',async()=>{
    const dir=await directory(),target=await directory();await symlink(target,join(dir,'link'));
    await writeFile(join(dir,'not-directory'),'keep');await writeFile(join(dir,'crawler.jsonl'),'x'.repeat(1000));
    for(const path of [join(dir,'link'),join(dir,'not-directory'),dir]){
      const sink=createCrawlerLogSink({directory:path,maxFileBytes:600,maxRecordBytes:300,onDiagnostic:()=>{throw Error('observer failed');}});
      sink.emit(record());await sink.close();expect(sink.stats().errors).toBe(1);expect(sink.stats().written).toBe(0);
    }
    expect(await readdir(target)).toEqual([]);expect(await readFile(join(dir,'not-directory'),'utf8')).toBe('keep');
  });
  it('serializes overlapping writers until the previous process releases its descriptor',async()=>{
    const dir=await directory(),first=createCrawlerLogSink({directory:dir}),second=createCrawlerLogSink({directory:dir});
    first.emit(record(1));await first.flush();
    second.emit(record(2));
    await new Promise(resolve=>setTimeout(resolve,50));
    expect(second.stats().written).toBe(0);
    await first.close();await second.close();
    const lines=(await readFile(join(dir,'crawler.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    expect(lines.map(line=>line.bytes)).toEqual([1,2]);
  });
  it('bounds graceful shutdown while a previous writer is still alive',async()=>{
    const dir=await directory(),first=createCrawlerLogSink({directory:dir}),second=createCrawlerLogSink({directory:dir,onDiagnostic:()=>{}});
    first.emit(record(1));await first.flush();second.emit(record(2));
    const start=Date.now();await second.close();expect(Date.now()-start).toBeLessThan(6500);
    expect(second.stats().dropped).toBe(1);expect(second.stats().errors).toBe(1);
    await first.close();
  },10_000);
  it('enforces safe configuration and handles one-file retention',async()=>{
    expect(()=>createCrawlerLogSink({directory:'relative'})).toThrow();
    expect(()=>createCrawlerLogSink({directory:'/tmp',maxFiles:0})).toThrow();
    const dir=await directory(),sink=createCrawlerLogSink({directory:dir,maxFiles:1,maxFileBytes:300,maxRecordBytes:300});
    sink.emit(record(1));await sink.flush();sink.emit(record(2));await sink.close();
    expect((await readdir(dir)).sort()).toEqual(['crawler.jsonl','crawler.lock']);expect(await readFile(join(dir,'crawler.jsonl'),'utf8')).not.toContain('"bytes":1');
  });
});
