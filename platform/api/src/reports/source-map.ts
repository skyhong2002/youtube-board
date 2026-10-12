/** A missing/malformed JSON cache is not an observed empty dictionary. */
export function sourceMap(value:unknown):Record<string,unknown>|null {
 if(typeof value==='string'){try{value=JSON.parse(value);}catch{return null;}}
 return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
}
/** Exact keys win. Conflicting encoded spellings do not create an ambiguous alias. */
export function sourceAliases(value:Record<string,unknown>):Record<string,unknown>{
 const result=Object.assign(Object.create(null) as Record<string,unknown>,value),candidates=new Map<string,string|null>();
 for(const key of Object.keys(value)){try{const decoded=decodeURIComponent(key.replace(/\+/g,' '));if(decoded===key||Object.hasOwn(value,decoded))continue;candidates.set(decoded,candidates.has(decoded)?null:key);}catch{}}
 for(const [decoded,key]of candidates)if(key!==null)result[decoded]=value[key];return result;
}
