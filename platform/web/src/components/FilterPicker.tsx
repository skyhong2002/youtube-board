import {api} from '@/lib/api';
import {resolveFilterSelection} from '@/lib/filter-picker';
import type {FilterOptions,FilterOptionKind} from '../../../shared/filter-options';
import FilterPickerInput from './FilterPickerInput';
export async function FilterPicker({name,label,kind,value='',multiple=true}:{name:string;label:string;kind:FilterOptionKind;value?:string|string[];multiple?:boolean}){
 // Name lookup is optional: deterministic failures keep the raw ids (failedIds). api() only
 // throws for transient ISR failures, which resolveFilterSelection would swallow into a
 // cacheable partial state, so re-raise them once the selection settles.
 let transient:unknown=null;
 const {initial,failedIds}=await resolveFilterSelection(kind,value,async ids=>{try{const result=await api<FilterOptions>('filter-options/'+kind,{ids:ids.join(',')},{optional:true});return result.ok?result.response.data:null;}catch(error){transient??=error;throw error;}});
 if(transient)throw transient;
 return <FilterPickerInput key={name+':'+JSON.stringify(value)} name={name} label={label} kind={kind} value={value} multiple={multiple} initial={initial} failedIds={failedIds}/>;
}
