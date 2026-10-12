import {canonicalHash as hash} from './ai-business-key.js';
/** Pure identities shared by publication writers and read-only snapshot verification. */
export function aiSourceHash(plan:{source:unknown[];input:unknown;sourceCount:unknown;omitted:unknown;bounds:unknown},model:string,version:string){
 const source=plan.source.map(row=>{const {viewCount,...stable}=row as Record<string,unknown>;return stable;}).sort((a,b)=>String(a.pk)<String(b.pk)?-1:String(a.pk)>String(b.pk)?1:0);
 return hash({version,model,input:plan.input,source,sourceCount:plan.sourceCount,omitted:plan.omitted,bounds:plan.bounds});
}
export function aiDerivedHash(p:{workflow:string;table:string;key:unknown;source:unknown;schema:unknown}){
 if(p.workflow==='ai.mayor_person'){
  const {videos,...source}=p.source as Record<string,unknown>&{videos:Record<string,unknown>[]};
  const stable=videos.map(({viewCount,commentCount,...video})=>video).sort((a,b)=>String(a.pk).localeCompare(String(b.pk),'en'));
  return hash({version:'yt-ai-mayor-quote-v1',model:'sky-quality',table:p.table,key:p.key,source:{...source,videos:stable},schema:p.schema});
 }
 return hash({version:'yt-ai-derived-v1',model:'sky-quality',plan:p});
}
