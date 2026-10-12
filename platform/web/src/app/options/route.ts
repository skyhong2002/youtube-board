import {api} from '@/lib/api';
import {filterOptionsQuery,filterOptionsMatch,type FilterOptions} from '../../../../shared/filter-options';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const params=new URL(request.url).searchParams,kind=params.get('kind'),query:Record<string,unknown>={};
 for(const key of params.keys()){if(key==='kind')continue;const all=params.getAll(key);query[key]=all.length===1?all[0]:all;}
 const input=params.getAll('kind').length===1?filterOptionsQuery(kind,query):null;
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(!input)return Response.json({error:'INVALID_OPTIONS_QUERY'},{status:400,headers});
 const result=await api<FilterOptions>('filter-options/'+input.kind,{...(input.q?{q:input.q}:{}),...(input.ids.length?{ids:input.ids.join(',')}:{}),limit:String(input.limit)});
 if(!result.ok)return Response.json({error:'OPTIONS_UNAVAILABLE'},{status:result.status===400?400:503,headers});
 if(!filterOptionsMatch(result.response.data,input))return Response.json({error:'INVALID_OPTIONS_RESPONSE'},{status:502,headers});
 return Response.json(result.response.data,{headers});
}
