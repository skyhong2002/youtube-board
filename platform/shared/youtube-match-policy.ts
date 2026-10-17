import {cities} from './city-definitions.js';
import {asciiCaseFold} from './ascii-case.js';
import noEqual from './tag-no-equal-tags.json' with {type:'json'};
import {isTagNoise} from './tag-noise.js';
import rankingExclusions from './youtube-ranking-exclusions.json' with {type:'json'};
/** Policies copied from tag-visuals 748978854035050c4de56e365ab94c178f4ddbe0.
 * Display exclusions never delete vocabulary terms or matching evidence.
 * YT 依使用者決定，排名同樣排除 no-equal 的人地黨類詞。 */
export const MATCH_RULE='youtube-quality-v2' as const;
export const MATCH_FIELD_WEIGHTS={title:3,description:1} as const;
export const TAG_POLICY_SOURCE={repository:'tag-visuals',commit:'748978854035050c4de56e365ab94c178f4ddbe0',files:['app/src/tag-noise.ts','app/data/no-equal-tags.json','app/src/v1/media-keywords.ts']} as const;
const excluded=new Set<string>([...noEqual.tags,'國際','生活','政治','財經','兩岸','社會','地方','體育','娛樂','科技','新聞']);
export const YOUTUBE_DISPLAY_POLICY_VERSION='youtube-platform-display-v5' as const;
/** Reviewed operator supplements where the pinned upstream policy has no rule.
 * Match entire NFKC labels only: named subjects containing these words stay eligible. */
const genericTwoCharacterTerms=new Set(rankingExclusions.genericTwoCharacterTerms);
const genericContextTerms=new Set(rankingExclusions.genericContextTerms);
/** Existing 22-city labels, their county/city suffix-free forms and 台/臺 spellings.
 * Exact labels only: 台北市長, 桃園機場 and named people remain untouched. */
const cityLabels=Object.values(cities).flatMap(({label})=>[label,label.replace(/[市縣]$/u,'')]).flatMap(label=>[label,label.replaceAll('台','臺')]);
const countryCityPartyTerms=new Set([...rankingExclusions.countryCityPartyTerms,...cityLabels]);
/** Operator-authorized display exclusions only. Terms and match evidence stay intact. */
export const YOUTUBE_PLATFORM_DISPLAY_TERMS=['YouTube','FB','Facebook','IG','Instagram','LINE','訂閱','會員','下載','連結','分享','直播','LIVE','影片','全新','主播','頻道','節目','平台','資訊','家'] as const;
/** 使用者核定的來源或平台名稱；其他候選詞須另行核定。 */
export const YOUTUBE_NEWS_SOURCE_DISPLAY_TERMS=['Yahoo','合作媒體','TVBS','聯合','三立'] as const;
const newsSourceExcluded=new Set(YOUTUBE_NEWS_SOURCE_DISPLAY_TERMS.map(asciiCaseFold));
const youtubeDisplayExcluded=new Set(YOUTUBE_PLATFORM_DISPLAY_TERMS.map(asciiCaseFold));
export type TagDisplayExclusion='youtube-source-or-platform'|'youtube-platform-or-promotion'|'youtube-generic-two-character'|'youtube-generic-context'|'youtube-country-city-party'|'upstream-length'|'upstream-no-equal-or-category'|'upstream-tag-noise'|'upstream-number-or-date'|'upstream-nonword';
/** Exact media-keywords policy, including JS string length and case-sensitive noEqual. */
export function tagDisplayExclusion(term:string):TagDisplayExclusion|null{
 const value=term.trim();
 if(newsSourceExcluded.has(asciiCaseFold(value)))return 'youtube-source-or-platform';
 if(youtubeDisplayExcluded.has(asciiCaseFold(value)))return 'youtube-platform-or-promotion';
 if(value.length<2||value.length>30)return 'upstream-length';
 if(excluded.has(value))return 'upstream-no-equal-or-category';
 if(isTagNoise(value))return 'upstream-tag-noise';
 const canonical=value.normalize('NFKC');
 if(countryCityPartyTerms.has(canonical))return 'youtube-country-city-party';
 if(genericContextTerms.has(canonical))return 'youtube-generic-context';
 if([...canonical].length===2&&genericTwoCharacterTerms.has(canonical))return 'youtube-generic-two-character';
 if(/^\d+(?:年|月|日)?$/.test(value))return 'upstream-number-or-date';
 if(!/[\p{L}\p{N}]/u.test(value))return 'upstream-nonword';
 return null;
}
/** Only a display grouping key; never a replacement source label or evidence key. */
export function tagDisplayGroup(term:string):string{return asciiCaseFold(term);}

/** Immutable snapshot metadata selects readers; legacy data remains usable before cutover. */
export function matchingRuleForSnapshot(snapshot:{matchingRule?:unknown}):'exact-text-v1'|typeof MATCH_RULE {
 if(snapshot.matchingRule===undefined||snapshot.matchingRule==='exact-text-v1')return 'exact-text-v1';
 if(snapshot.matchingRule===MATCH_RULE)return MATCH_RULE;throw new Error('Unknown vocabulary matching rule');
}
