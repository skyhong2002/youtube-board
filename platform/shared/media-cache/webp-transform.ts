import {spawn} from 'node:child_process';
import {rejectPngAnimation} from './transform.js';
import {createRequire} from 'node:module';
import {AVATAR_WEBP_WIDTHS,type AvatarWebpWidth} from '../media-assets.js';
import {MEDIA_LIMITS,MediaCacheError,validAvatarWebp} from './store.js';
// One bounded, killable native process per source. Sequential encodes, one libvips
// worker, low WebP effort: no parallel image workload on the shared host.
const decoder=String.raw`
const sharp=require(process.argv[1]);let chunks=[],bytes=0;
process.stdin.on('data',b=>{bytes+=b.length;if(bytes>524288)process.exit(2);chunks.push(b)});
process.stdin.on('end',async()=>{try{
 sharp.cache(false);sharp.concurrency(1);const body=Buffer.concat(chunks);
 const options={limitInputPixels:36864,sequentialRead:true,failOn:'error',animated:false};
 const m=await sharp(body,options).metadata();
 if(m.format!=='png'||m.width!==192||m.height!==192||(m.pages||1)!==1)process.exit(2);
 for(const width of [48,96,192]){const out=await sharp(body,options).resize(width,width).webp({quality:78,effort:2}).toBuffer();if(out.length>65536)process.exit(2);const n=Buffer.alloc(4);n.writeUInt32BE(out.length);process.stdout.write(n);process.stdout.write(out);}
 }catch{process.exit(2)}});
`;
export async function avatarWebpDerivatives(png:Buffer,signal?:AbortSignal):Promise<Map<AvatarWebpWidth,Buffer>>{
 if(png.length>MEDIA_LIMITS.outputBytes)throw new MediaCacheError('INVALID_ASSET');
 rejectPngAnimation(png);signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--max-old-space-size=96','-e',decoder,createRequire(import.meta.url).resolve('sharp')],{stdio:['pipe','pipe','ignore'],env:{LANG:'C',VIPS_CONCURRENCY:'1'}});
  const chunks:Buffer[]=[];let bytes=0,settled=false;
  const finish=(error?:string)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){child.kill('SIGKILL');reject(new MediaCacheError(error));}};
  const abort=()=>finish('IMAGE_TRANSFORM_ABORTED'),timer=setTimeout(()=>finish('IMAGE_TRANSFORM_TIMEOUT'),5000);
  signal?.addEventListener('abort',abort,{once:true});
  child.on('error',()=>finish('IMAGE_TRANSFORM_FAILED'));child.stdin.on('error',()=>finish('IMAGE_TRANSFORM_FAILED'));
  child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>3*(MEDIA_LIMITS.webpBytes+4)){finish('IMAGE_TRANSFORM_FAILED');return;}chunks.push(chunk);});
  child.on('close',code=>{
   if(settled)return;if(code!==0){finish('IMAGE_TRANSFORM_FAILED');return;}
   try{
    const all=Buffer.concat(chunks),outputs=new Map<AvatarWebpWidth,Buffer>();let at=0;
    for(const width of AVATAR_WEBP_WIDTHS){if(at+4>all.length)throw Error();const n=all.readUInt32BE(at);at+=4;if(n>all.length-at)throw Error();const body=all.subarray(at,at+n);at+=n;if(!validAvatarWebp(body,width))throw Error();outputs.set(width,body);}
    if(at!==all.length)throw Error();finish();resolve(outputs);
   }catch{finish('IMAGE_TRANSFORM_FAILED');}
  });
  child.stdin.end(png);if(signal?.aborted)abort();
 });
}
