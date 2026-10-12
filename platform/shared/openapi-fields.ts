/** Pure field traversal shared by generated docs and API docs UI. */
export interface OpenApiField {path:string;type:string;required:boolean;description:string}
type S=Record<string,unknown>;
export function openApiFields(schema:S,schemas:Record<string,S>,maximumDepth=8):OpenApiField[]{
 const result:OpenApiField[]=[];
 const walk=(input:S,path:string,required:boolean,depth:number,seen:Set<string>)=>{
  if(depth>maximumDepth)return;
  if(typeof input.$ref==='string'){
   const name=input.$ref.replace('#/components/schemas/','');
   if(seen.has(name)||!schemas[name]){result.push({path,type:seen.has(name)?'recursive reference':'unresolved reference',required,description:String(input.description??'')});return;}
   return walk({...schemas[name],...Object.fromEntries(Object.entries(input).filter(([k])=>k!=='$ref'))},path,required,depth,new Set([...seen,name]));
  }
  const type=Array.isArray(input.type)?input.type.join(' | '):typeof input.type==='string'?input.type:input.const!==undefined?typeof input.const:input.anyOf?'union':'unspecified';
  if(path)result.push({path,type,required,description:typeof input.description==='string'?input.description:''});
  if(input.properties&&typeof input.properties==='object')for(const [key,child]of Object.entries(input.properties as Record<string,S>))walk(child,path?path+'.'+key:key,Array.isArray(input.required)&&input.required.includes(key),depth+1,seen);
  if(input.items&&typeof input.items==='object')walk(input.items as S,path+'[]',false,depth+1,seen);
  for(const kind of ['allOf','oneOf','anyOf'])if(Array.isArray(input[kind]))for(const child of input[kind] as S[])walk(child,path,false,depth+1,seen);
 };
 walk(schema,'',true,0,new Set());return result;
}
