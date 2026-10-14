import 'server-only';
import {fetchKeywordMetadata} from './keyword-metadata';
/** Deliberately bypass api()/ISR caching: metadata stays private,no-store and only recognised
 * public DTO fields reach the client. Never access cookies(), headers(), or service credentials. */
export function readKeywordMetadata(keyword:string){
 return fetchKeywordMetadata(keyword,process.env.YOUTUBE_API_BASE_URL||'http://127.0.0.1:4100/api/v1');
}
