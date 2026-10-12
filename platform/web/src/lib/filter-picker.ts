import {filterOptionsMatch,selectedFilterIds,type FilterOption,type FilterOptionKind,type FilterOptions} from '../../../shared/filter-options';
export async function loadFilterOptions(kind:FilterOptionKind,q:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<FilterOptions>{
 const response=await fetcher('/options?'+new URLSearchParams({kind,q}),{signal,cache:'no-store'});
 if(!response.ok)throw new Error('OPTIONS_UNAVAILABLE');const data:unknown=await response.json();if(!filterOptionsMatch(data,{kind,ids:[],limit:20}))throw new Error('INVALID_OPTIONS_RESPONSE');return data;
}

export async function resolveFilterSelection(kind:FilterOptionKind,value:string|string[],lookup:(ids:string[])=>Promise<unknown>):Promise<{initial:FilterOption[];failedIds:string[]}>{
 const ids=typeof value==='string'?selectedFilterIds(value):null,initial:FilterOption[]=[],failedIds:string[]=[];
 if(ids){const batches=Array.from({length:Math.ceil(ids.length/20)},(_,i)=>ids.slice(i*20,i*20+20));
  // Only selected names are resolved, in bounded batches and concurrency.
  for(let i=0;i<batches.length;i+=3)await Promise.all(batches.slice(i,i+3).map(async batch=>{try{const data=await lookup(batch);if(filterOptionsMatch(data,{kind,ids:batch,limit:20})){initial.push(...data.rows);return;}}catch{/* Preserve source identities when lookup fails. */}failedIds.push(...batch);}));
 }
 return {initial,failedIds};
}

export const composingFilterKey=(event:{isComposing?:boolean;keyCode?:number},active=false)=>active||event.isComposing===true||event.keyCode===229;
