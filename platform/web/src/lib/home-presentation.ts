import type {HomeExploration} from '../../../api/src/contracts';
import {dateTime} from './format';
/** A homepage edition is source time, never request/render time. */
export function homeEdition(updatedAt:string|null,aiDate:string|null){
 for(const value of [updatedAt,aiDate]){if(!value)continue;const formatted=dateTime(value,true);if(formatted!=='未記錄')return `觀測資料 ${formatted}`;}
 return '持續觀察 YouTube 公共討論';
}
/** Non-published or unavailable keyword rows must not masquerade as current matches. */
export function visibleHomeKeywords(keywords:Pick<HomeExploration['keywords'],'status'|'rows'>){return keywords.status==='synchronized'?keywords.rows:[];}
