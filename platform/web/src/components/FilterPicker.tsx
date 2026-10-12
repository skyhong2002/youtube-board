import {api} from '@/lib/api';
import {resolveFilterSelection} from '@/lib/filter-picker';
import type {FilterOptions,FilterOptionKind} from '../../../shared/filter-options';
import FilterPickerInput from './FilterPickerInput';
export async function FilterPicker({name,label,kind,value='',multiple=true}:{name:string;label:string;kind:FilterOptionKind;value?:string|string[];multiple?:boolean}){
 const {initial,failedIds}=await resolveFilterSelection(kind,value,async ids=>{const result=await api<FilterOptions>('filter-options/'+kind,{ids:ids.join(',')});return result.ok?result.response.data:null;});
 return <FilterPickerInput key={name+':'+JSON.stringify(value)} name={name} label={label} kind={kind} value={value} multiple={multiple} initial={initial} failedIds={failedIds}/>;
}
