import {isChannelAvatar,type ChannelAvatar} from './media-assets.ts';
/** Small read-only vocabulary for selection controls; IDs are never user-entered. */
export const FILTER_OPTION_LIMIT=20;
export type FilterOptionKind='tags'|'channels';
export interface FilterOption {id:string;label:string;avatar?:ChannelAvatar|null}
export interface FilterOptions {kind:FilterOptionKind;rows:FilterOption[];hasMore:boolean;missingIds:string[]}
const positive=(value:string)=>/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>0;
export function selectedFilterIds(value:string):string[]|null{
 if(value.length>256)return null;if(!value)return [];
 // Canonical reports use comma-separated IDs. Spaces are not another delimiter.
 const parts=value.split(',');if(parts.some(v=>!positive(v)))return null;
 return [...new Set(parts.map(v=>String(Number(v))))];
}
export function filterOptionsQuery(kind:unknown,query:Record<string,unknown>):{kind:FilterOptionKind;q:string;ids:string[];limit:number}|null{
 if(kind!=='tags'&&kind!=='channels'||Object.keys(query).some(k=>!['q','ids','limit'].includes(k)))return null;
 if(query.q!==undefined&&(typeof query.q!=='string'||query.q.length>100||new TextEncoder().encode(query.q).length>400))return null;
 if(query.ids!==undefined&&typeof query.ids!=='string')return null;
 const ids=selectedFilterIds(query.ids as string||'');if(ids===null||ids.length>FILTER_OPTION_LIMIT)return null;
 const limit=query.limit===undefined?FILTER_OPTION_LIMIT:typeof query.limit==='string'&&/^\d+$/.test(query.limit)?Number(query.limit):NaN;
 if(!Number.isInteger(limit)||limit<1||limit>FILTER_OPTION_LIMIT)return null;
 if(ids.length&&typeof query.q==='string'&&query.q.trim())return null;
 return {kind,q:typeof query.q==='string'?query.q.trim():'',ids,limit};
}
export function isFilterOptions(value:unknown,kind:FilterOptionKind):value is FilterOptions{
 if(!value||typeof value!=='object')return false;const d=value as FilterOptions;
 return d.kind===kind&&typeof d.hasMore==='boolean'&&Array.isArray(d.rows)&&d.rows.length<=FILTER_OPTION_LIMIT&&d.rows.every(r=>r&&typeof r.id==='string'&&positive(r.id)&&typeof r.label==='string'&&(r.avatar===undefined||r.avatar===null||isChannelAvatar(r.avatar)&&r.avatar.url.startsWith('/media/channels/'+r.id+'/'))&&r.label.length>0&&new TextEncoder().encode(r.label).length<=1024)&&new Set(d.rows.map(r=>r.id)).size===d.rows.length&&Array.isArray(d.missingIds)&&d.missingIds.length<=FILTER_OPTION_LIMIT&&d.missingIds.every(v=>typeof v==='string'&&positive(v));
}

/** Validate the response against its request as well as its scalar schema. */
export function filterOptionsMatch(value:unknown,input:{kind:FilterOptionKind;ids:string[];limit:number}):value is FilterOptions{
 if(!isFilterOptions(value,input.kind))return false;
 const returned=[...value.rows.map(row=>row.id),...value.missingIds];
 if(new Set(returned).size!==returned.length)return false;
 return input.ids.length? !value.hasMore&&returned.length===input.ids.length&&returned.every(id=>input.ids.includes(id)) : value.missingIds.length===0&&value.rows.length<=input.limit;
}
