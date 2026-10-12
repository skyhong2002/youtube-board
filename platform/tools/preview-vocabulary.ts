/** Explicit read-only live preview; writes only a sanitized receipt to stdout. */
import {HttpSnapshotSource} from '../jobs/src/snapshot-client.js';
import {tagHttpOptions} from '../jobs/src/tag-http.js';
import {previewVocabulary} from '../jobs/src/vocabulary-preview.js';

if(!process.argv.includes('--live')||process.argv.some(x=>x.startsWith('--')&&x!=='--live')) {
 process.stderr.write('Usage: node --expose-gc --max-old-space-size=384 --import tsx tools/preview-vocabulary.ts --live\n');process.exit(2);
}
if(!global.gc){process.stderr.write('Preview requires --expose-gc for comparable heap measurements.\n');process.exit(2);}
try {
 const signal=AbortSignal.timeout(8*60*1000),options=await tagHttpOptions(process.env);
 const source=new HttpSnapshotSource(fetch,options,signal);
 const result=await previewVocabulary(source,{signal,onProgress:event=>{
  if(event.phase==='changes'||event.pages%10===0)process.stderr.write(JSON.stringify({code:'VOCABULARY_PREVIEW_PROGRESS',...event})+'\n');
 }});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){
 // Never stringify errors, response bodies, credentials or environment blocks.
 const name=error instanceof Error&&error.name==='SnapshotResnapshotRequired'?'RESNAPSHOT_REQUIRED':'PREVIEW_FAILED';
 process.stderr.write(JSON.stringify({code:name,servingPointerChanged:false})+'\n');process.exitCode=1;
}
