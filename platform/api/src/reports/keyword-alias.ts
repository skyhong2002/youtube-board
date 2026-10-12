import {sql,type SQL} from 'drizzle-orm';
import type {Reader} from '../db/client.js';
import {DataQueryFailed} from '../db/client.js';
import {ReportReadBound} from './cache-weights.js';
import {asciiCaseFold,asciiLiteralPattern} from '../../../shared/ascii-case.js';
const MAX_ALIASES=1024,MAX_SNAPSHOT_BYTES=16*1024*1024;
export interface KeywordIdentity{key:string;term:string}
/** Read actual immutable pool identities, not a hash of a normalized label.
 * SQL LOWER is a broad bounded prefilter; JS enforces ASCII-only equivalence. */
export async function maintainedKeywordIdentities(reader:Reader,version:string,keyword:string):Promise<KeywordIdentity[]>{
 const [run]=await reader.rows(sql`SELECT OCTET_LENGTH(snapshot) AS alias_snapshot_bytes,JSON_EXTRACT(snapshot,'$.termsStoredSeparately') AS separate_terms FROM ts_vocabulary_runs WHERE id=${version} AND status='published' LIMIT 1`);
 if(!run)return [];
 if(Number(run.alias_snapshot_bytes)>MAX_SNAPSHOT_BYTES)throw new ReportReadBound('Keyword vocabulary snapshot exceeds read budget');
 const separate=run.separate_terms===true||run.separate_terms===1||run.separate_terms==='true';
 const rows=separate?await reader.rows(sql`SELECT term_key,term FROM ts_vocabulary_terms WHERE run_id=${version} AND BINARY LOWER(term)=BINARY LOWER(${keyword}) ORDER BY term_key LIMIT ${MAX_ALIASES+1}`):await reader.rows(sql`SELECT t.term_key,t.term FROM ts_vocabulary_runs r,JSON_TABLE(r.snapshot,'$.terms[*]' COLUMNS(term_key VARCHAR(64) PATH '$.key',term VARCHAR(480) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.term')) t WHERE r.id=${version} AND r.status='published' AND BINARY LOWER(t.term)=BINARY LOWER(${keyword}) ORDER BY t.term_key LIMIT ${MAX_ALIASES+1}`);
 if(rows.length>MAX_ALIASES)throw new ReportReadBound('Keyword aliases exceed read budget');
 const folded=asciiCaseFold(keyword),matched=rows.filter(row=>typeof row.term==='string'&&asciiCaseFold(row.term)===folded);
 if(matched.some(row=>typeof row.term_key!=='string'||!/^[a-f0-9]{64}$/.test(row.term_key)))throw new DataQueryFailed('INVALID_VOCABULARY_TERM_KEY');
 matched.sort((a,b)=>String(a.term_key)<String(b.term_key)?-1:String(a.term_key)>String(b.term_key)?1:0);
 return matched.map(row=>({key:String(row.term_key),term:String(row.term)}));
}
/** No case conversion of non-ASCII text and no wildcard/regex interpretation. */
export function keywordTextContains(column:SQL,keyword:string):SQL{
 return /[A-Za-z]/.test(keyword)?sql`CAST(COALESCE(${column},'') AS BINARY) REGEXP BINARY ${asciiLiteralPattern(keyword)}`:sql`LOCATE(CAST(${keyword} AS BINARY),CAST(COALESCE(${column},'') AS BINARY))>0`;
}
