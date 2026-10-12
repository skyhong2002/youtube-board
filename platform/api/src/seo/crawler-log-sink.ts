import {constants} from 'node:fs';
import {mkdir,lstat,chmod,open,rename,unlink,type FileHandle} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';

export type CrawlerLogEntry = {
  code:'CRAWLER_RESPONSE';at:string;method:string;path:string;status:number;
  bytes:number|null;userAgent:string;cfRay:string|null;
  cfCountry?:string|null;cfColo?:string|null;completed?:boolean;
}|{code:'CRAWLER_LOG_SUPPRESSED';count:number};
type Diagnostic={code:'CRAWLER_LOG_SINK_ERROR'|'CRAWLER_LOG_SINK_DROPPED';count:number;dropped:number};
interface Options {
  directory:string;maxFileBytes?:number;maxFiles?:number;maxQueueBytes?:number;
  maxRecordBytes?:number;onDiagnostic?:(record:Diagnostic)=>void;
}

/** A descriptor-owned flock serializes start-first replicas on the same volume.
 * Stores only sanitized crawler metadata; never pass request objects to emit.
 * Retention is bounded by maxFiles * maxFileBytes (active file included).
 * File errors and queue pressure drop diagnostics, never public requests. */
export function createCrawlerLogSink(options:Options) {
  const maxFileBytes=options.maxFileBytes??5*1024*1024,maxFiles=options.maxFiles??4;
  const maxQueueBytes=options.maxQueueBytes??256*1024,maxRecordBytes=options.maxRecordBytes??2048;
  for(const value of [maxFileBytes,maxFiles,maxQueueBytes,maxRecordBytes])
    if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid crawler sink limit');
  if(maxFiles>16||maxFileBytes>64*1024*1024||maxQueueBytes>4*1024*1024||maxRecordBytes>8192||maxRecordBytes>maxFileBytes||maxRecordBytes>maxQueueBytes)
    throw Error('Invalid crawler sink limit');
  if(!isAbsolute(options.directory)||options.directory.includes('\0'))throw Error('Invalid crawler sink directory');
  const filename=(index:number)=>join(options.directory,index===0?'crawler.jsonl':`crawler.jsonl.${index}`);
  let handle:FileHandle|undefined,lock:FileHandle|undefined,size=0,queuedBytes=0,closed=false,running:Promise<void>|undefined;
  const queue:Buffer[]=[];
  const totals={written:0,dropped:0,errors:0};
  let nextDiagnostic=0,nextDropDiagnostic=0;
  let lockChild:ChildProcess|undefined;
  function reportFailure() {
    totals.errors++;
    if(Date.now()<nextDiagnostic)return;
    nextDiagnostic=Date.now()+30_000;
    const record:Diagnostic={code:'CRAWLER_LOG_SINK_ERROR',count:totals.errors,dropped:totals.dropped};
    try {
      if(options.onDiagnostic)options.onDiagnostic(record);
      else if(!process.stderr.writableNeedDrain)process.stderr.write(JSON.stringify(record)+'\n');
    }catch{/* Diagnostics never affect requests. */}
  }
  function drop() {
    totals.dropped++;
    if(Date.now()<nextDropDiagnostic)return;
    nextDropDiagnostic=Date.now()+30_000;
    const record:Diagnostic={code:'CRAWLER_LOG_SINK_DROPPED',count:totals.dropped,dropped:totals.dropped};
    try {
      if(options.onDiagnostic)options.onDiagnostic(record);
      else if(!process.stderr.writableNeedDrain)process.stderr.write(JSON.stringify(record)+'\n');
    }catch{/* Diagnostics never affect requests. */}
  }
  async function inspect(path:string) {
    const stat=await lstat(path).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
    if(stat&&(!stat.isFile()||stat.nlink!==1||stat.size>maxFileBytes))throw Error('Unsafe crawler log file');
    return stat;
  }
  async function acquireLock() {
    if(lock)return;
    const path=join(options.directory,'crawler.lock');
    await inspect(path);
    lock=await open(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
    const stat=await lock.stat();
    if(!stat.isFile()||stat.nlink!==1)throw Error('Unsafe crawler lock file');
    await lock.chmod(0o600);
    // flock ownership follows the shared open-file description: after the
    // helper exits, this descriptor retains the lock until close or process exit.
    // No shell, arbitrary command, body buffers, or unbounded lock wait.
    await new Promise<void>((resolve,reject)=>{
      const child=spawn('flock',['-x','-w','60','3'],{stdio:['ignore','ignore','ignore',lock!.fd]});
      lockChild=child;
      child.once('error',error=>{lockChild=undefined;reject(error);});
      child.once('exit',code=>{lockChild=undefined;code===0?resolve():reject(Error('Crawler lock unavailable'));});
    });
  }
  async function initialize() {
    await mkdir(options.directory,{recursive:true,mode:0o700});
    const directoryStat=await lstat(options.directory);
    if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink())throw Error('Unsafe crawler log directory');
    await chmod(options.directory,0o700);
    await acquireLock();
    for(let index=0;index<maxFiles;index++)await inspect(filename(index));
    handle=await open(filename(0),constants.O_CREAT|constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    const stat=await handle.stat();
    if(!stat.isFile()||stat.nlink!==1||stat.size>maxFileBytes)throw Error('Unsafe crawler log file');
    await handle.chmod(0o600);size=stat.size;
  }
  async function rotate() {
    await handle?.close();handle=undefined;
    for(let index=0;index<maxFiles;index++)await inspect(filename(index));
    await unlink(filename(maxFiles-1)).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});
    for(let index=maxFiles-2;index>=0;index--)
      await rename(filename(index),filename(index+1)).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});
    await initialize();
  }
  async function work() {
    try {
      if(!handle)await initialize();
      while(queue.length) {
        const line=queue[0]!;
        if(size+line.byteLength>maxFileBytes)await rotate();
        await handle!.writeFile(line);
        size+=line.byteLength;queuedBytes-=line.byteLength;queue.shift();totals.written++;
      }
    }catch {
      totals.dropped+=queue.length;queue.length=0;queuedBytes=0;reportFailure();
      await handle?.close().catch(()=>{});handle=undefined;
      await lock?.close().catch(()=>{});lock=undefined;
    }
  }
  function schedule() {
    if(running||!queue.length)return;
    running=Promise.resolve().then(work).finally(()=>{
      running=undefined;
      // A callback can enqueue after work resolves but before finally runs.
      if(queue.length)schedule();
    });
  }
  function emit(record:CrawlerLogEntry):void {
    if(closed){drop();return;}
    try {
      // Project known fields so accidental extra properties cannot reach disk.
      const safe=record.code==='CRAWLER_LOG_SUPPRESSED'
        ?{code:record.code,count:record.count}
        :record.code==='CRAWLER_RESPONSE'
          ?{code:record.code,at:record.at,method:record.method,path:record.path,status:record.status,bytes:record.bytes,userAgent:record.userAgent,cfRay:record.cfRay,cfCountry:record.cfCountry,cfColo:record.cfColo,completed:record.completed}
          :null;
      if(!safe){drop();return;}
      const line=Buffer.from(JSON.stringify(safe)+'\n');
      if(line.byteLength>maxRecordBytes||queuedBytes+line.byteLength>maxQueueBytes){drop();return;}
      queue.push(line);queuedBytes+=line.byteLength;
      schedule();
    }catch{drop();}
  }
  async function flush() {while(running)await running;}
  async function close() {
    closed=true;
    const deadline=setTimeout(()=>lockChild?.kill('SIGKILL'),5000);deadline.unref();
    try{await flush();}finally{clearTimeout(deadline);}
    try{await handle?.close();}catch{reportFailure();}finally{handle=undefined;}
    try{await lock?.close();}catch{reportFailure();}finally{lock=undefined;}
  }
  return {emit,flush,close,stats:()=>({...totals,queuedBytes})};
}
