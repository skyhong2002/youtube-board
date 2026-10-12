import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {MEDIA_LIMITS,MediaCacheError} from './store.js';
import {rasterType} from './download.js';
export interface AvatarRaster {png:Buffer;sourceWidth:number;sourceHeight:number}
/** libvips can silently flatten APNG without exposing metadata.pages. Inspect
 * actual bounded PNG chunks, never search compressed pixels for marker strings. */
export function rejectPngAnimation(body:Buffer){
 if(rasterType(body)!=='image/png')return;
 let at=8,chunks=0;
 while(at<body.length){
  if(++chunks>4096||at+12>body.length)throw new MediaCacheError('IMAGE_TYPE_REJECTED');
  const length=body.readUInt32BE(at),type=body.toString('ascii',at+4,at+8);
  if(length>body.length-at-12)throw new MediaCacheError('IMAGE_TYPE_REJECTED');
  if(['acTL','fcTL','fdAT'].includes(type))throw new MediaCacheError('IMAGE_ANIMATION_REJECTED');
  at+=length+12;if(type==='IEND')return;
 }
 throw new MediaCacheError('IMAGE_TYPE_REJECTED');
}
// Native decoding runs outside the long-lived web/worker process and can be killed.
const decoder=String.raw`
const sharp=require(process.argv[1]);let chunks=[],bytes=0;
process.stdin.on('data',b=>{bytes+=b.length;if(bytes>2097152)process.exit(2);chunks.push(b)});
process.stdin.on('end',async()=>{try{
 sharp.cache(false);sharp.concurrency(1);
 const body=Buffer.concat(chunks),image=sharp(body,{limitInputPixels:16777216,sequentialRead:true,failOn:'error',animated:false});
 const m=await image.metadata();
 if(!['jpeg','png','webp'].includes(m.format)||!m.width||!m.height||m.width<16||m.height<16||m.width>4096||m.height>4096||(m.pages||1)!==1)process.exit(2);
 const png=await image.rotate().resize(192,192,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
 if(png.length>524288)process.exit(2);
 process.stdout.write(JSON.stringify({sourceWidth:m.width,sourceHeight:m.height})+'\n');process.stdout.end(png);
 }catch{process.exit(2)}});
`;
export async function normalizeAvatar(body:Buffer,signal?:AbortSignal):Promise<AvatarRaster>{
 if(body.length>MEDIA_LIMITS.inputBytes||!rasterType(body))throw new MediaCacheError('IMAGE_TYPE_REJECTED');
 rejectPngAnimation(body);
 signal?.throwIfAborted();
 const sharpPath=createRequire(import.meta.url).resolve('sharp');
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--max-old-space-size=96','-e',decoder,sharpPath],{stdio:['pipe','pipe','ignore'],env:{LANG:'C',VIPS_CONCURRENCY:'1'}});
  const chunks:Buffer[]=[];let size=0,settled=false;
  const finish=(error?:string)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){child.kill('SIGKILL');reject(new MediaCacheError(error));}};
  const abort=()=>finish('IMAGE_TRANSFORM_ABORTED'),timer=setTimeout(()=>finish('IMAGE_TRANSFORM_TIMEOUT'),5000);
  signal?.addEventListener('abort',abort,{once:true});
  child.on('error',()=>finish('IMAGE_TRANSFORM_FAILED'));child.stdin.on('error',()=>finish('IMAGE_TRANSFORM_FAILED'));
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>MEDIA_LIMITS.outputBytes+256){finish('IMAGE_TRANSFORM_FAILED');return;}chunks.push(chunk);});
  child.on('close',code=>{
   if(settled)return;if(code!==0){finish('IMAGE_TRANSFORM_FAILED');return;}
   try{const out=Buffer.concat(chunks),newline=out.indexOf(10);if(newline<1||newline>256)throw Error();const meta=JSON.parse(out.subarray(0,newline).toString()),png=out.subarray(newline+1);if(rasterType(png)!=='image/png'||png.length>MEDIA_LIMITS.outputBytes||![meta.sourceWidth,meta.sourceHeight].every(n=>Number.isSafeInteger(n)&&n>=16&&n<=4096))throw Error();finish();resolve({png,sourceWidth:meta.sourceWidth,sourceHeight:meta.sourceHeight});}catch{finish('IMAGE_TRANSFORM_FAILED');}
  });
  child.stdin.end(body);if(signal?.aborted)abort();
 });
}
