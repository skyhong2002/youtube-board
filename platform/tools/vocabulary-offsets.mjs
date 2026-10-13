/** Offline reusable normalization/evidence adapter. No imports, IO, storage,
 * serving pointer, active matching-rule selection or worker activation.
 * Coordinates are original UTF-16 code units, never normalized-text offsets.
 * The contract is a helper identifier, NOT a production matching rule. */
export const OFFSET_CONTRACT = 'nfkc-zero-width-ascii-original-offsets-proposal-v1';
export const OFFSET_ENGINE = Object.freeze({unicodeVersion: process.versions.unicode, icuVersion: process.versions.icu, segmentation: 'Intl.Segmenter/grapheme', caseFold: 'ASCII-only'});
const removable = /[\u200B\u200C\u200D\u2060\uFEFF]/u;
const unsupportedFormat = /\p{Cf}/u;
const unsupportedControl = /[\p{Cc}]/u;
const latinWord = /[\p{Script=Latin}\p{M}\p{Number}_]/u;
const tokenCharacter = /[\p{L}\p{M}\p{N}_]/u;
const maps = new WeakMap();
const groups = new WeakSet();
const segmenter = new Intl.Segmenter('und', {granularity: 'grapheme'});
export class OffsetNormalizationError extends Error {
  constructor(reason) { super(`Offset normalization rejected: ${reason}`); this.name = 'OffsetNormalizationError'; this.reason = reason; }
}
const reject = reason => { throw new OffsetNormalizationError(reason); };
function freezePayload(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezePayload(child, seen);
  return Object.freeze(value);
}
function cap(value, fallback) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1) reject('invalid-budget');
  return n;
}
function validateText(raw, limit, label) {
  if (typeof raw !== 'string') reject('not-string');
  if (raw.length > limit) reject('raw-length');
  if (/[\uD800-\uDFFF]/u.test(raw)) reject('lone-surrogate');
  for (const point of raw) {
    if (removable.test(point)) continue;
    if (unsupportedFormat.test(point) || unsupportedControl.test(point) && (label || !['\t', '\r', '\n'].includes(point))) reject('unsupported-control');
  }
}
/** Same stable NFKC/remove/ASCII-fold sequence as the current label preview.
 * Source text deliberately retains whitespace; labels separately trim edges. */
function stableNormalize(cleaned, maxUnits, label = false) {
  let value = cleaned;
  for (let pass = 0; pass < 8; pass++) {
    let next = value.normalize('NFKC').replace(/[\u200B\u200C\u200D\u2060\uFEFF]/gu, '').replace(/[A-Z]/g, c => c.toLowerCase());
    if (label) next = next.trim();
    if (next.length > maxUnits) reject('normalized-length');
    validateText(next, maxUnits, label);
    if (next === value) return next;
    value = next;
  }
  reject('normalization-did-not-stabilize');
}
export function normalizeOffsetLabel(raw) {
  validateText(raw, 240, true);
  return stableNormalize(raw.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/gu, ''), 240, true);
}
/** Retain each original span for one cleaned grapheme. Segmentation happens AFTER
 * approved zero-width removal, so e + zero-width + accent still composes together.
 * Whole-text equivalence is checked; uncertain cross-grapheme composition rejects.
 * Expansion boundaries are atomic: "fi" cannot be projected out of original ﬃ.
 * Default output cap is explicit and independent of production writer limits. */
export function normalizeTextWithOffsets(raw, options = {}) {
  const maxInputUnits = cap(options.maxInputUnits, 100000), maxOutputUnits = cap(options.maxOutputUnits, 400000);
  validateText(raw, maxInputUnits, false);
  const points = []; let cleaned = '', originalOffset = 0;
  for (const point of raw) {
    const end = originalOffset + point.length;
    if (!removable.test(point)) {
      points.push({cleanStart: cleaned.length, cleanEnd: cleaned.length + point.length, start: originalOffset, end});
      cleaned += point;
    }
    originalOffset = end;
  }
  const segments = []; let normalized = '', pointIndex = 0;
  for (const cluster of segmenter.segment(cleaned)) {
    const cleanEnd = cluster.index + cluster.segment.length;
    if (points[pointIndex]?.cleanStart !== cluster.index) reject('grapheme-code-point-boundary');
    const first = points[pointIndex];
    while (points[pointIndex]?.cleanEnd < cleanEnd) pointIndex++;
    const last = points[pointIndex++];
    if (last?.cleanEnd !== cleanEnd) reject('grapheme-code-point-boundary');
    const value = stableNormalize(cluster.segment, maxOutputUnits);
    if (!value) reject('empty-normalization-atom');
    const normalizedStart = normalized.length;
    normalized += value;
    if (normalized.length > maxOutputUnits) reject('normalized-length');
    segments.push(Object.freeze({normalizedStart, normalizedEnd: normalized.length, start: first.start, end: last.end}));
  }
  if (normalized !== stableNormalize(cleaned, maxOutputUnits)) reject('cross-grapheme-normalization');
  const result = Object.freeze({contract: OFFSET_CONTRACT, engine: OFFSET_ENGINE, raw, normalized, segments: Object.freeze(segments)});
  // Boundary maps stay private; callers cannot forge a projection by mutating JSON.
  maps.set(result, {starts: new Map(segments.map(s => [s.normalizedStart, s.start])), ends: new Map(segments.map(s => [s.normalizedEnd, s.end]))});
  return result;
}
export function originalRange(mapped, normalizedStart, normalizedEnd) {
  const boundaries = maps.get(mapped);
  if (!boundaries) reject('untrusted-offset-map');
  if (!Number.isSafeInteger(normalizedStart) || !Number.isSafeInteger(normalizedEnd) || normalizedStart < 0 || normalizedEnd <= normalizedStart || normalizedEnd > mapped.normalized.length) return null;
  const start = boundaries.starts.get(normalizedStart), end = boundaries.ends.get(normalizedEnd);
  return start === undefined || end === undefined ? null : {start, end, text: mapped.raw.slice(start, end)};
}
/** Derive a bounded matching profile without replacing ANY raw source identity.
 * Accepted aliases and explicitly rejected raw records remain separate. Canonical
 * occurrence identity is the smallest RAW termKey; no normalized hash is invented.
 * Payloads are cloned intact; counts/provenance/upstream objects are not summed.
 * This is NOT a complete full-pool importer or a production snapshot publisher. */
export function normalizedIdentityGroups(sourceTerms, options = {}) {
  const maxSourceTerms = cap(options.maxSourceTerms, 100000), maxNormalizedUnits = cap(options.maxNormalizedUnits, 2000000), maxSourceBytes = cap(options.maxSourceBytes, 64 * 1024 * 1024);
  const byLabel = new Map(), seen = new Set(), rejected = []; let units = 1, count = 0, sourceBytes = 0;
  for (const source of sourceTerms) {
    if (++count > maxSourceTerms) reject('source-term-budget');
    if (!source || typeof source.termKey !== 'string' || !/^[a-f0-9]{64}$/.test(source.termKey) || typeof source.term !== 'string') reject('invalid-source-identity');
    if (seen.has(source.termKey)) reject('duplicate-source-identity');
    seen.add(source.termKey);
    let encoded, retained;
    try { encoded = JSON.stringify(source); } catch { reject('invalid-source-payload'); }
    sourceBytes += Buffer.byteLength(encoded);
    if (sourceBytes > maxSourceBytes) reject('source-byte-budget');
    try { retained = freezePayload(structuredClone(source)); } catch { reject('invalid-source-payload'); }
    let label;
    try { label = normalizeOffsetLabel(source.term); }
    catch (error) { if (!(error instanceof OffsetNormalizationError)) throw error; rejected.push(Object.freeze({sourceTerm: retained, reason: error.reason})); continue; }
    if ([...label].length < 2) { rejected.push(Object.freeze({sourceTerm: retained, reason: 'short-label'})); continue; }
    let group = byLabel.get(label);
    if (!group) {
      units += label.length;
      if (units > maxNormalizedUnits) reject('normalized-term-budget');
      group = {normalizedLabel: label, sourceTerms: []}; byLabel.set(label, group);
    }
    group.sourceTerms.push(retained);
  }
  const result = [...byLabel.values()].map(group => {
    group.sourceTerms.sort((a, b) => a.termKey < b.termKey ? -1 : a.termKey > b.termKey ? 1 : 0);
    const value = Object.freeze({normalizedLabel: group.normalizedLabel, sourceTerms: Object.freeze(group.sourceTerms), canonicalSourceTerm: group.sourceTerms[0]});
    groups.add(value); return value;
  }).sort((a, b) => a.normalizedLabel < b.normalizedLabel ? -1 : a.normalizedLabel > b.normalizedLabel ? 1 : 0);
  return Object.freeze({groups: Object.freeze(result), rejected: Object.freeze(rejected), sourceTerms: count, sourceBytes, normalizedUnits: units});
}
function previousPoint(text, offset) { return text.slice(Math.max(0, offset - 2), offset).match(/.$/u)?.[0] ?? ''; }
function nextPoint(text, offset) { const point = text.codePointAt(offset); return point === undefined ? '' : String.fromCodePoint(point); }
/** Use this after trie candidate generation in normalized coordinates. Then apply
 * description-template masks and longest-overlap selection in ORIGINAL spans.
 * Matching identity/raw term and matched text stay separate from normalized label.
 * A returned proposal is never method=youtube-quality-v2 or persistable approval. */
export function projectNormalizedEvidence(mapped, normalizedStart, normalizedEnd, group, options = {}) {
  if (!groups.has(group)) reject('untrusted-identity-group');
  const range = originalRange(mapped, normalizedStart, normalizedEnd);
  if (!range || mapped.normalized.slice(normalizedStart, normalizedEnd) !== group.normalizedLabel) return null;
  const points = [...group.normalizedLabel], before = previousPoint(mapped.normalized, normalizedStart), after = nextPoint(mapped.normalized, normalizedEnd);
  if (points.length > 1 && (latinWord.test(points[0]) && latinWord.test(before) || latinWord.test(points.at(-1)) && latinWord.test(after))) return null;
  if (points.length === 1 && (tokenCharacter.test(before) || tokenCharacter.test(after))) return null;
  const contextUnits = cap(options.contextUnits, 40);
  let snippetStart = Math.max(0, range.start - contextUnits), snippetEnd = Math.min(mapped.raw.length, range.end + contextUnits);
  // Never bisect an astral code point in the contextual snippet either.
  if (snippetStart > 0 && /[\uDC00-\uDFFF]/.test(mapped.raw[snippetStart])) snippetStart--;
  if (snippetEnd < mapped.raw.length && /[\uDC00-\uDFFF]/.test(mapped.raw[snippetEnd])) snippetEnd++;
  return Object.freeze({contract: OFFSET_CONTRACT, engine: OFFSET_ENGINE, proposalOnly: true,
    termKey: group.canonicalSourceTerm.termKey, term: group.canonicalSourceTerm.term,
    sourceTerms: group.sourceTerms, normalizedLabel: group.normalizedLabel,
    normalizedStart, normalizedEnd, ...range,
    storageCompatibility: Object.freeze({matchedTextCharacters: [...range.text].length, existingMatchedTextVarchar240: [...range.text].length <= 240}),
    snippet: mapped.raw.slice(snippetStart, snippetEnd), snippetStart});
}
/** Small-input adapter/demo for ONE compiled identity group, not a full-pool scan.
 * A production trie may call projectNormalizedEvidence for each candidate instead.
 * All raw occurrences are returned; exclusion masks/longest selection are external. */
export function findNormalizedOccurrences(mapped, group, options = {}) {
  const maxOccurrences = cap(options.maxOccurrences, 10000);
  if (!groups.has(group) || !maps.has(mapped)) reject('untrusted-matching-input');
  const found = []; let cursor = 0, candidates = 0;
  while (cursor < mapped.normalized.length) {
    const start = mapped.normalized.indexOf(group.normalizedLabel, cursor);
    if (start < 0) break;
    if (++candidates > maxOccurrences) reject('occurrence-budget');
    const item = projectNormalizedEvidence(mapped, start, start + group.normalizedLabel.length, group, options);
    if (item) found.push(item);
    cursor = start + 1;
  }
  return found;
}
