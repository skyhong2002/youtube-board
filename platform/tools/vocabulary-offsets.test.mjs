import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OFFSET_CONTRACT, OffsetNormalizationError, normalizeOffsetLabel, normalizeTextWithOffsets, originalRange, normalizedIdentityGroups, projectNormalizedEvidence, findNormalizedOccurrences} from './vocabulary-offsets.mjs';
const rawTerm = term => ({termKey: createHash('sha256').update('https://tag.observe.tw\0'+term).digest('hex'), term, upstreamId: createHash('sha256').update(term).digest('hex'), articleCount: 3, upstream: {label: term, origin: 'article-tags-mixed'}});
const group = (...terms) => normalizedIdentityGroups(terms.map(rawTerm)).groups[0];
function verifyRaw(mapped, evidence) {
  for (const item of evidence) {
    assert.equal(item.text, mapped.raw.slice(item.start, item.end));
    assert.equal(item.snippet.slice(item.start-item.snippetStart, item.end-item.snippetStart), item.text);
    assert.equal(normalizeOffsetLabel(item.text), item.normalizedLabel);
    assert.equal(item.proposalOnly, true); assert.equal(item.contract, OFFSET_CONTRACT);
    assert.equal(Object.hasOwn(item, 'method'), false);
  }
}

test('fullwidth and approved zero widths normalize while raw UTF-16 evidence remains exact', () => {
  const raw='😀開頭 Ａ\u200bＩ\u200c\u200d\u2060\ufeff 新聞';
  const mapped=normalizeTextWithOffsets(raw), evidence=findNormalizedOccurrences(mapped, group('AI'));
  assert.equal(mapped.raw, raw); assert.equal(mapped.normalized, '😀開頭 ai 新聞');
  assert.equal(evidence.length, 1); assert.equal(evidence[0].start, 5); assert.equal(evidence[0].end, 8);
  assert.equal(evidence[0].text, 'Ａ\u200bＩ'); verifyRaw(mapped,evidence);
});
test('supported zero widths inside Han terms map to the complete original span', () => {
  const mapped=normalizeTextWithOffsets('前 新\u200b聞\u200c台 後'), evidence=findNormalizedOccurrences(mapped,group('新聞台'));
  assert.equal(evidence[0].text,'新\u200b聞\u200c台'); verifyRaw(mapped,evidence);
});
test('combining composition and canonical reordering keep atomic source spans', () => {
  for(const raw of ['前 cafe\u0301 後','前 cafe\u200b\u0301 後']) {
    const mapped=normalizeTextWithOffsets(raw), evidence=findNormalizedOccurrences(mapped,group('café'));
    assert.equal(evidence.length,1); verifyRaw(mapped,evidence);
    const accent=mapped.segments.find(s=>mapped.normalized.slice(s.normalizedStart,s.normalizedEnd)==='é');
    assert.ok(accent); assert.equal(mapped.raw.slice(accent.start,accent.end),raw.includes('\u200b')?'e\u200b\u0301':'e\u0301');
  }
  const reordered=normalizeTextWithOffsets('a\u0315\u0300');
  assert.equal(reordered.normalized,'à\u0315');
  assert.equal(originalRange(reordered,0,1),null); assert.equal(originalRange(reordered,1,2),null);
  assert.deepEqual(originalRange(reordered,0,2),{start:0,end:3,text:'a\u0315\u0300'});
});
test('folding-exposed compositions and Hangul/halfwidth compositions equal whole NFKC', () => {
  for(const raw of ['J\u030C','\u1100\u1161\u11A8','ｶﾞ','Ａ\u030a']) {
    const mapped=normalizeTextWithOffsets(raw);
    assert.equal(mapped.normalized,normalizeOffsetLabel(raw));
    assert.deepEqual(originalRange(mapped,0,mapped.normalized.length),{start:0,end:raw.length,text:raw});
  }
  assert.equal(normalizeOffsetLabel('J\u030C'),'ǰ');
});
test('ligature expansion is atomic; partial normalized substrings never acquire evidence', () => {
  const mapped=normalizeTextWithOffsets(' ﬃ ');
  assert.equal(mapped.normalized,' ffi ');
  assert.equal(originalRange(mapped,1,3),null); assert.equal(originalRange(mapped,2,4),null);
  assert.equal(findNormalizedOccurrences(mapped,group('ff')).length,0);
  assert.equal(findNormalizedOccurrences(mapped,group('fi')).length,0);
  const complete=findNormalizedOccurrences(mapped,group('FFI'));
  assert.equal(complete.length,1); assert.equal(complete[0].text,'ﬃ'); verifyRaw(mapped,complete);
});
test('compatibility expansion cannot create a shorter phrase inside one source character', () => {
  const mapped=normalizeTextWithOffsets('㌀');
  assert.equal(mapped.normalized,'アパート');
  assert.equal(findNormalizedOccurrences(mapped,group('パート')).length,0);
  const evidence=findNormalizedOccurrences(mapped,group('アパート'));
  assert.equal(evidence[0].text,'㌀'); verifyRaw(mapped,evidence);
});
test('English boundaries use normalized neighbors, including fullwidth/combining variants', () => {
  const mapped=normalizeTextWithOffsets('RAＩN xＡＩ AI_2 AI\u0301 ＡＩ新聞 ai emoji😀AI'), evidence=findNormalizedOccurrences(mapped,group('AI'));
  assert.equal(evidence.length,3); assert.deepEqual(evidence.map(e=>e.text),['ＡＩ','ai','AI']); verifyRaw(mapped,evidence);
  for(const raw of ['ＸＡＩ','ＡＩ２','ＡＩ_','ＡＩ\u0301','éAI','AIé'])assert.equal(findNormalizedOccurrences(normalizeTextWithOffsets(raw),group('AI')).length,0);
});
test('AI permits Chinese neighbors but never chair/mail/RAIL substrings; one-Han terms stay rejected', () => {
  const mapped=normalizeTextWithOffsets('AI模型 模型AI chair mail RAIL'), evidence=findNormalizedOccurrences(mapped,group('AI','ai'));
  assert.deepEqual(evidence.map(e=>e.text),['AI','AI']); verifyRaw(mapped,evidence);
  const chinese=normalizeTextWithOffsets('新聞台 台灣新聞');
  assert.equal(findNormalizedOccurrences(chinese,group('新聞')).length,2);
  const single=normalizedIdentityGroups([rawTerm('新')]);
  assert.equal(single.groups.length,0); assert.equal(single.rejected[0].reason,'short-label');
});
test('punctuation and existing URL/template masks keep original offset coordinates after normalization', () => {
  const raw='😀前\u200b文 https://foo/Ａ\u200bＩ?x=1； AI模型', mapped=normalizeTextWithOffsets(raw);
  const evidence=findNormalizedOccurrences(mapped,group('AI'));
  assert.equal(evidence.length,2); assert.deepEqual(evidence.map(e=>e.text),['Ａ\u200bＩ','AI']);
  const start=raw.indexOf('https://'), end=raw.indexOf('；'), originalMask=new Uint8Array(raw.length);
  originalMask.fill(1,start,end);
  const masked=evidence.filter(e=>originalMask.subarray(e.start,e.end).some(Boolean));
  const accepted=evidence.filter(e=>!originalMask.subarray(e.start,e.end).some(Boolean));
  assert.equal(masked.length,1); assert.equal(masked[0].text,'Ａ\u200bＩ');
  assert.equal(accepted.length,1); assert.equal(accepted[0].text,'AI');
  assert.notEqual(evidence[0].start,evidence[0].normalizedStart);
  verifyRaw(mapped,evidence);
});
test('ASCII folding does not silently equate non-ASCII case or Greek confusables', () => {
  assert.equal(normalizeOffsetLabel('ÉCOLE'),'École');
  assert.equal(findNormalizedOccurrences(normalizeTextWithOffsets('école ΑI'),group('ÉCOLE')).length,0);
  assert.equal(findNormalizedOccurrences(normalizeTextWithOffsets('ΑI'),group('AI')).length,0);
});
test('surrogate pairs stay intact in mapping and contextual snippets', () => {
  const mapped=normalizeTextWithOffsets('😀AI😀'), evidence=findNormalizedOccurrences(mapped,group('AI'),{contextUnits:1});
  assert.equal(originalRange(mapped,0,1),null); assert.equal(originalRange(mapped,1,2),null);
  assert.equal(evidence[0].start,2); assert.equal(evidence[0].end,4); assert.equal(evidence[0].snippet,'😀AI😀');
  verifyRaw(mapped,evidence);
  const astral=normalizeTextWithOffsets('𠀀新聞'), all=findNormalizedOccurrences(astral,group('𠀀新聞'));
  assert.deepEqual([all[0].start,all[0].end],[0,4]); verifyRaw(astral,all);
});
test('multiline raw text and whitespace are preserved; only label edges trim', () => {
  const raw=' \r\n\tＡＩ\r\n ', mapped=normalizeTextWithOffsets(raw);
  assert.equal(mapped.normalized,' \r\n\tai\r\n ');
  assert.equal(normalizeOffsetLabel(' \u200bＡＩ '),'ai');
  verifyRaw(mapped,findNormalizedOccurrences(mapped,group('AI')));
});
test('raw alias identities and upstream payloads survive normalization; rejected terms stay explicit', () => {
  const source=['AI','ai','ＡＩ','A\u200bI','新聞台','看','bad\n','\ud800'].map(rawTerm), before=JSON.stringify(source);
  const result=normalizedIdentityGroups(source), alias=result.groups.find(g=>g.normalizedLabel==='ai');
  assert.equal(JSON.stringify(source),before); assert.equal(result.groups.length,2); assert.equal(result.rejected.length,3);
  assert.deepEqual(alias.sourceTerms.map(s=>s.termKey),source.slice(0,4).map(s=>s.termKey).sort());
  assert.equal(alias.canonicalSourceTerm.termKey,alias.sourceTerms[0].termKey);
  assert.deepEqual([...result.groups.flatMap(g=>g.sourceTerms),...result.rejected.map(r=>r.sourceTerm)].map(s=>s.termKey).sort(),source.map(s=>s.termKey).sort());
  for(const item of alias.sourceTerms)assert.deepEqual(item,source.find(s=>s.termKey===item.termKey));
  const mapped=normalizeTextWithOffsets('ＡＩ'), evidence=findNormalizedOccurrences(mapped,alias);
  assert.equal(evidence[0].term,alias.canonicalSourceTerm.term); assert.equal(evidence[0].text,'ＡＩ');
  assert.equal(evidence[0].sourceTerms.length,4); verifyRaw(mapped,evidence);
  source[0].upstream.label='mutated caller'; assert.notEqual(alias.sourceTerms.find(s=>s.term==='AI').upstream.label,'mutated caller');
  assert.throws(()=>{alias.sourceTerms[0].upstream.label='mutated helper';},TypeError);
});
test('control/lone-surrogate/length and normalized-output budgets reject whole input', () => {
  for(const raw of ['a\u202e','a\u00ad','a\u0000','\ud800','\udc00'])assert.throws(()=>normalizeTextWithOffsets(raw),OffsetNormalizationError);
  assert.throws(()=>normalizeTextWithOffsets('aaa',{maxInputUnits:2}),e=>e.reason==='raw-length');
  assert.throws(()=>normalizeTextWithOffsets('ﬃ',{maxOutputUnits:2}),e=>e.reason==='normalized-length');
  assert.throws(()=>normalizeOffsetLabel('a'.repeat(241)),e=>e.reason==='raw-length');
  assert.throws(()=>normalizeOffsetLabel('\ufdfa'.repeat(14)),e=>e.reason==='normalized-length');
});
test('term/occurrence budgets abort instead of silently truncating or publishing a partial match', () => {
  assert.throws(()=>normalizedIdentityGroups([rawTerm('AI'),rawTerm('ai')],{maxSourceTerms:1}),e=>e.reason==='source-term-budget');
  assert.throws(()=>normalizedIdentityGroups([rawTerm('AI')],{maxNormalizedUnits:2}),e=>e.reason==='normalized-term-budget');
  assert.throws(()=>normalizedIdentityGroups([rawTerm('AI')],{maxSourceBytes:1}),e=>e.reason==='source-byte-budget');
  const cyclic=rawTerm('AI'); cyclic.upstream.self=cyclic;
  assert.throws(()=>normalizedIdentityGroups([cyclic]),e=>e.reason==='invalid-source-payload');
  assert.throws(()=>normalizedIdentityGroups([rawTerm('AI'),rawTerm('AI')]),e=>e.reason==='duplicate-source-identity');
  assert.throws(()=>findNormalizedOccurrences(normalizeTextWithOffsets('AI AI'),group('AI'),{maxOccurrences:1}),e=>e.reason==='occurrence-budget');
});
test('long removed-character gaps preserve raw evidence and explicitly exceed current VARCHAR240 storage', () => {
  const raw='A'+'\u200b'.repeat(300)+'I', mapped=normalizeTextWithOffsets(raw), evidence=findNormalizedOccurrences(mapped,group('AI'));
  assert.equal(evidence[0].text,raw); assert.deepEqual([evidence[0].start,evidence[0].end],[0,302]);
  assert.equal(evidence[0].storageCompatibility.matchedTextCharacters,302);
  assert.equal(evidence[0].storageCompatibility.existingMatchedTextVarchar240,false);
  assert.equal(evidence[0].proposalOnly,true);
});
test('unknown or malformed projections cannot masquerade as raw mapped evidence', () => {
  const mapped=normalizeTextWithOffsets('AI'), identity=group('AI');
  assert.throws(()=>originalRange({...mapped},0,2),e=>e.reason==='untrusted-offset-map');
  assert.throws(()=>projectNormalizedEvidence(mapped,0,2,{...identity}),e=>e.reason==='untrusted-identity-group');
  for(const [start,end] of [[-1,2],[0,0],[0,3],[0.1,2],[NaN,2]])assert.equal(originalRange(mapped,start,end),null);
});
test('deterministic Unicode vector combinations preserve whole normalization and every projected slice', () => {
  const atoms=['Ａ','I','ﬃ','㌀','e\u0301','a\u0315\u0300','J\u030c','𠀀','😀','新\u200b聞','\u1100\u1161','ｶﾞ'];
  for(const left of atoms)for(const right of atoms) {
    const raw='前 '+left+' '+right+' 後', mapped=normalizeTextWithOffsets(raw);
    assert.equal(mapped.normalized,normalizeOffsetLabel(raw));
    for(const segment of mapped.segments) {
      const span=originalRange(mapped,segment.normalizedStart,segment.normalizedEnd);
      assert.equal(normalizeOffsetLabel(span.text),mapped.normalized.slice(segment.normalizedStart,segment.normalizedEnd).trim());
      assert.equal(span.text,raw.slice(span.start,span.end));
    }
  }
});
