import {describe,it,expect} from 'vitest';
import {hash,type ExportTerm} from '../src/snapshot-client.js';
import {buildMatchingSnapshot,normalizeMatchingLabel,MatchingNormalizationError,MatchingPreviewBudgetError} from '../src/vocabulary-normalization.js';
import {assertVocabularyBudget} from '../src/vocabulary-budget.js';
const identity={id:'preview-only',generatedAt:'2026-10-13T00:00:00.000Z'};
const term=(label:string,articleCount=3):ExportTerm=>({id:hash(label),label,articleCount,firstPublishedAt:identity.generatedAt,lastPublishedAt:identity.generatedAt,origin:'article-tags-mixed',journalistAssigned:null});
describe('read-only matching normalization',()=>{
  it('strips supported zero widths, applies NFKC and ASCII folding',()=>{
    expect(normalizeMatchingLabel(' \u200bＡ\u200cＩ\u200d\u2060\ufeff ')).toBe('ai');
    expect(normalizeMatchingLabel('新聞\u200b台')).toBe('新聞台');
    expect(normalizeMatchingLabel('ÉCOLE')).toBe('École');
  });
  it('is idempotent including compositions exposed by ASCII folding',()=>{
    for(const raw of ['J\u030C','ＡＩ','\ufdfa','①','\u200b新\u200c聞',' e\u0301ABC ','😀新聞','\ufeff']){
      const label=normalizeMatchingLabel(raw);expect(normalizeMatchingLabel(label)).toBe(label);
    }
    expect(normalizeMatchingLabel('J\u030C')).toBe('ǰ');
  });
  it('rejects controls, lone surrogates and raw/normalized length safely',()=>{
    for(const raw of ['hello\n','hi\tthere','hi\u202e','hi\u0000','hi\u00ad','hi\ud800','hi\udc00','a'.repeat(241),'\ufdfa'.repeat(14)])expect(()=>normalizeMatchingLabel(raw)).toThrow(MatchingNormalizationError);
    expect(normalizeMatchingLabel('😀')).toBe('😀');expect(normalizeMatchingLabel('a'.repeat(240))).toHaveLength(240);
  });
  it('retains exact aliases deterministically and uses maximum count without mutating input',()=>{
    const source=[term('AI',2),term('ai',9),term('ＡＩ',4),term('A\u200bI',7),term('新聞台',5)];
    const untouched=JSON.stringify(source),result=buildMatchingSnapshot(source,identity);
    expect(JSON.stringify(source)).toBe(untouched);expect(result).toEqual(buildMatchingSnapshot([...source].reverse(),identity));
    const alias=result.aliases.find(group=>group.label==='ai')!;
    expect(alias.rawAliases.map(entry=>entry.id)).toEqual(source.slice(0,4).map(entry=>entry.id).sort());
    expect(alias.canonicalId).toBe(alias.rawAliases[0]!.id);
    expect(result.snapshot.terms.find(entry=>entry.term==='ai')).toMatchObject({articleCount:9,upstreamId:alias.canonicalId});
    expect(result.metrics).toMatchObject({sourceTerms:5,acceptedSourceTerms:5,matchingTerms:2,aliasesMerged:3,normalizationChanged:3,zeroWidthChanged:1,normalizedCodeUnits:5});
    expect(()=>assertVocabularyBudget(result.snapshot.terms)).not.toThrow();
  });
  it('reports rejection reasons without inventing a stopword policy',()=>{
    const result=buildMatchingSnapshot([{...term('news'),noise:true},term('看'),term('😀'),term('ＦＢ'),term('訂閱'),term('\u200b'),term('bad\n'),term('\ud800'),term('a'.repeat(241)),term('\ufdfa'.repeat(14))],identity);
    expect(result.snapshot.terms.map(entry=>entry.term).sort()).toEqual(['fb','訂閱']);
    expect(result.metrics.rejected).toEqual({noise:1,'short-label':3,'unsupported-control':1,'lone-surrogate':1,'raw-length':1,'normalized-length':1});
  });
  it('budgets expanded units after normalization and fails rather than truncates',()=>{
    const label=normalizeMatchingLabel('\ufdfa');expect(label.length).toBeGreaterThan(1);
    expect(()=>buildMatchingSnapshot([term('\ufdfa')],identity,{maxNormalizedCodeUnits:label.length})).toThrow(MatchingPreviewBudgetError);
    expect(buildMatchingSnapshot([term('\ufdfa')],identity,{maxNormalizedCodeUnits:label.length+1}).metrics.normalizedCodeUnits).toBe(label.length);
    expect(buildMatchingSnapshot([term('AI'),term('ai')],identity,{maxMatchingTerms:1,maxNormalizedCodeUnits:3}).metrics.matchingTerms).toBe(1);
    expect(()=>buildMatchingSnapshot([term('ai'),term('bb')],identity,{maxMatchingTerms:1})).toThrow(MatchingPreviewBudgetError);
    expect(()=>buildMatchingSnapshot([term('ai')],identity,{maxMatchingTerms:0})).toThrow('Invalid matching preview budget');
  });
  it('rejects duplicate exact identities',()=>{
    expect(()=>buildMatchingSnapshot([term('AI'),term('AI')],identity)).toThrow('Duplicate upstream identity');
  });
});
