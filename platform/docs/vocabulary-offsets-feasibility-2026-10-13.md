# V04 normalization and original evidence: offline source preparation

The standalone [offset helper](../tools/vocabulary-offsets.mjs) implements normalized
text projection back to original UTF-16 spans. It does not publish a vocabulary,
select an active matching rule, change a worker, or make the preview serve traffic.
APP `70529cff13b6b7f5b3e0571a229e2b61660f9df4` is unchanged. TAG still owns the
common build slot. This work uses source reads and builtin offline tests only;
there is no build, capture, API/DB startup, remote access or live probe.

## Exact gaps in the production-target source

The audit describes repository code paths, not a live production observation.
Laravel still owns production background writes; no TS writer handoff is implied.

| Source | Existing contract | Normalization integration gap |
| --- | --- | --- |
| `jobs/src/vocabulary-normalization.ts` | Preview strips five approved zero widths, stabilizes NFKC/ASCII folding, and groups raw aliases separately. Derived snapshot terms use normalized keys/labels and one canonical upstream ID. | The separate `rawAliases` are not production snapshot/evidence lineage. Passing the derived snapshot alone into a writer would lose the other exact identities. It normalizes labels only. |
| `jobs/src/load-vocabulary.ts` | Stored term key must hash the **raw** label; payload label/key/count must equal the validated upstream record. Active subset keys/checksum describe stored raw payloads. | It correctly refuses replacing raw labels with normalized preview labels, and does not derive a normalized matching profile after validating the raw source. Normalized expansion needs its own budget; raw units alone are insufficient. |
| `jobs/src/match.ts` | Trie and text fold ASCII only; indexes are unchanged original UTF-16. Latin/mark/number/underscore boundaries reject English substrings, while multi-character Chinese substrings are permitted. Template masks and overlap occupancy use original spans. | NFKC can compose, expand and reorder characters; zero-width removal changes offsets. Applying normalization to text without a map would corrupt evidence and masks. A trie must project a complete normalized candidate before masks/overlap selection. |
| `jobs/src/video-evidence.ts` | Fingerprint covers original title/description. Marker, quality audit and evidence write are transactional and use an explicit v2 candidate rule. Raw alias provenance is stored in quality audit; row term/key remains canonical. | A new normalization contract must have a separately selected rule/profile, while preserving raw fingerprints and all aliases. Reusing `youtube-quality-v2` would silently change its meaning and could leave existing evidence looking current. |
| `shared/youtube-match-policy.ts`, quality candidate/activation, recent cursor and template profile code | Readers/writers/profile/cursor checks recognize `exact-text-v1` and `youtube-quality-v2`, with immutable candidate/anchor and lineage guards. | A separately approved normalized policy must be added consistently to selector, types, template proofs, markers, cursor generations, cache lineage and activation checks; no helper string is an active policy. |
| `api/src/reports/keyword-alias.ts` and `keyword-candidates.ts` | Look up actual raw pool identities using database LOWER plus ASCII identity checks, then query exact term key/raw label. | NFKC/fullwidth/zero-width alias equivalence is not represented in these lookups. A normalized profile needs a bounded explicit raw-identity association usable by writers and readers; keeping aliases only in a preview array is insufficient. |
| `migrations/002-frontend-state.sql` | `matched_text VARCHAR(240)`; snippets retain original text and offsets. | Removing hundreds of zero widths can produce a short normalized match with an original span over240 characters. Original evidence must be retained, not truncated. The future writer must explicitly classify/reject an incompatible candidate or use a reviewed schema change. |

## Helper contract

`normalizeTextWithOffsets(raw)` returns the unchanged raw string, normalized string
and immutable original-span segments. It removes U+200B/U+200C/U+200D/U+2060/U+FEFF,
then uses stable NFKC and ASCII folding. Text retains whitespace/newlines; vocabulary
label edges trim under the same preview label contract. Unsupported formats,
controls other than text tab/CR/LF, lone surrogates and exceeded budgets reject the
whole operation. There is no new stopword/noise or vocabulary activation policy.

Segmentation occurs **after** zero-width removal so `e + zero-width + accent` can
compose with a correct raw span. Each cleaned grapheme maps to one atomic original
interval. The concatenation must equal whole-text normalization; uncertain
cross-grapheme results reject explicitly. Start/end must be complete atom boundaries:
`ﬃ → ffi` cannot create a shorter `fi` match, and a reordered combining sequence
cannot be sliced into false independent evidence. Surrogate halves cannot project.
Contextual snippets also keep supplementary code points intact.

`normalizedIdentityGroups(rawRecords)` preserves every supplied record in accepted
raw alias groups or explicit rejected records. Records are cloned and deeply frozen;
raw term keys/labels, upstream IDs/payloads and counts remain intact. Canonical
occurrence identity is the lexicographically smallest **raw term key**, not a hash
of the normalized label. Counts are never summed. This bounded profile does not
replace storage of the complete source pool or select which upstream terms are
eligible; the caller must retain that complete pool and apply its reviewed selection.

`projectNormalizedEvidence(map, start, end, group)` adapts normalized trie candidates
to raw evidence. It checks Latin/mark/number/underscore neighbors on normalized text,
so `AI模型` and `模型AI` match but `chair`, `mail` and `RAIL` do not. Multi-character
Chinese substring matching remains available; one-character labels are retained as
explicit `short-label` rejections. Raw term identity, normalized label and original
matched text are separate fields. The result includes original snippet coordinates,
all aliases and explicit existing-VARCHAR240 compatibility. It is always a proposal
and has no production `method` or serving-version field.

Apply existing URL/CTA/template masks **after projection in original coordinates**;
then apply the separately reviewed longest-overlap policy. The helper does not
silently change those policies or automatically drop masked evidence.
`findNormalizedOccurrences` is a bounded one-group adapter/demo. It is not an
O(source terms × text) replacement for the production trie.

The map records the local Unicode/ICU engine versions. Future candidate evidence
must pin Node/Unicode/ICU along with the algorithm and source/profile version. The
helper identifier `nfkc-zero-width-ascii-original-offsets-proposal-v1` is not a new
production rule and must never be substituted for `youtube-quality-v2`.

Default source-text limits are100,000 raw UTF-16 units and400,000 normalized units.
The matching profile limits100,000 input records,2,000,000 normalized units including
a root reserve, and64MiB aggregate serialized raw record bytes; the one-group adapter
limits10,000 candidate occurrences. Exceeding a cap aborts, without partial profile
publication or truncation. These are explicit helper bounds, not measured worker
memory/performance evidence or a newly approved production policy.

## Reusable source example

```js
import {
  normalizedIdentityGroups, normalizeTextWithOffsets,
  findNormalizedOccurrences,
} from '../tools/vocabulary-offsets.mjs';

// The caller already validated the immutable raw snapshot; it retains that pool.
const profile = normalizedIdentityGroups(
  snapshot.terms.map(term => ({...term, termKey: term.key})),
);
const titleMap = normalizeTextWithOffsets(video.title);
const ai = profile.groups.find(group => group.normalizedLabel === 'ai');
const proposals = ai ? findNormalizedOccurrences(titleMap, ai) : [];
// Preserve proposals' raw start/end/text/aliases. A production adapter still owns
// exclusions, overlap policy, explicit version, source fingerprint and transaction.
```

## Feasibility and remaining dependencies

Complete **source integration is offline feasible**: upstream already supplies exact
IDs and raw labels, so Unicode offset projection itself needs no new upstream API.
A followup branch can reuse this helper while keeping full-pool storage separate,
compile normalized labels with raw identity groups, project trie candidates, apply
raw template masks, store compatible raw evidence/alias associations, and add dual
readers and candidate activation tests. No production access is needed to implement
that source work.

This bounded task deliberately leaves that integration unconnected. It needs owner
agreement on a separately versioned matching contract, normalized alias association,
longest-overlap/boundary behavior, storage overflow handling and profile budgets.
It also needs coordinated changes across the files above; APP70529 cannot be mutated
as a side effect. Full-pool/delta checkpoint ownership and upstream pinned snapshot
recovery are separate inventory items, not completed by this helper.

A serving change remains dependent on reviewed source, approved isolated MariaDB
integration after tag→YT handoff, actual evidence/source fingerprint/offset roundtrips,
reader/cache compatibility, bounded resource measurements, verified backups, writer
ownership and explicit candidate/activation approval. Existing source/version and
24-hour fallback remain available. There is no UI/runtime/source-writer acceptance
or claim that preview vocabulary now drives production matching.

## Offline validation

`nice -n 19 node --test --test-concurrency=1 platform/tools/vocabulary-offsets.test.mjs`
passes18 tests with no skips. Tests exercise fullwidth and all five zero widths,
combining composition/reordering, folding-exposed composition, Hangul/halfwidth kana,
ligature and compatibility expansion, English/Chinese boundaries, preserved alias
payloads, original URL-mask coordinates, surrogate-safe snippets, multiline text,
long raw spans, budget rejection and144 deterministic Unicode atom pairs. These are
pure source tests; no SQL, upstream fetch, browser or worker was run.
