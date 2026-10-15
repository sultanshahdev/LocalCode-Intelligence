# Behavioral Search Evaluation

## Investigation (before the change)

The merged baseline (`ff986b1`) discovers JavaScript/TypeScript files, creates
overlapping 40-line regions, obtains semantic and lexical candidate lists, and
fuses their top 50 members with reciprocal-rank fusion. Relevance assessment
then decides whether the final top five are sufficiently grounded.

Exact identifier queries already recognize declaration/assignment syntax, but
natural-language behavior queries have no equivalent structural signal. A test
region can therefore win when it has stronger lexical or embedding rank than
the region defining the behavior. File paths contribute lexical tokens only;
they do not currently identify test or example roles. The relevance gate is
appropriately conservative for unrelated queries, but is not an implementation
selector.

The proposed change keeps discovery, segmentation, embeddings, fusion, API
shape, and relevance gating intact. It adds deterministic query intent and
lightweight source evidence after fusion. Full measured results are appended
after the evaluation run.

## Retrieval architecture

`query → intent → semantic + lexical retrieval → RRF fusion → evidence-aware
rerank → relevance assessment → display`.

Intent is classified with transparent word and symbol patterns: identifier,
implementation, test, example, usage, or conceptual. Candidate evidence is
derived from common JavaScript/TypeScript declaration forms, executable control
flow, path role (`test`, `spec`, `examples`, `docs`), and test assertion calls.
These signals are ordinal ranking hints rather than confidence scores. They only
reorder candidates already admitted by fused retrieval; no source is excluded
because it lives in a test or example directory.

For implementation and identifier intent, declarations with executable logic
are preferred and test/example roles are demoted. Test/example intents reverse
that role preference. Usage queries slightly prefer non-definitions. Conceptual
queries receive only a small implementation preference.

## Limitations

This is lightweight syntax recognition, not AST or control-flow analysis. It
can miss unusual declaration styles, generated APIs, and implementations whose
defining context falls outside a retrieved source window. Search remains
bounded by source discovery limits and only the fused candidate pool can be
reranked. A result is evidence to inspect, not proof that no other
implementation exists.


## Four-repository evaluation (at PR revision b24126f)

The user ran 4 separate evaluation-split benchmarks at pinned source
revisions. All metrics below use **file-level** labels, not verified
function/line-level matches.

| Repository | Positive / negative | Baseline R@1 | Intent-aware R@1 | Baseline R@5 | Intent-aware R@5 |
|---|---:|---:|---:|---:|---:|
| LocalCode | 6 / 1 | 5/6 | 6/6 | 6/6 | 6/6 |
| Express | 5 / 1 | 5/5 | 5/5 | 5/5 | 5/5 |
| Axios | 6 / 1 | 5/6 | 5/6 | 5/6 | 5/6 |
| Fastify | 6 / 1 | 2/6 | 4/6 | 4/6 | 5/6 |
| **Pooled** | **23 / 4** | **17/23 (73.9%)** | **20/23 (87.0%)** | **20/23 (87.0%)** | **21/23 (91.3%)** |

Both configurations correctly abstained on the 4 negative queries.
Pooled MRR@5 was 0.804 baseline versus 0.884 intent-aware.
The Fastify Reply query moved from false negative to within the top
five; Fastify wrapThenable and hooks and LocalCode concurrency improved
rank. No observed regression on this small evaluation slice.

Embedding precomputation took 16s for LocalCode, 74s for Express,
226s for Axios, and 317s for Fastify. RSS snapshots were around
1.1-1.4 GiB, not peak process memory. Warm per-query latency
does not include indexing.

### Subsequent changes require independent re-evaluation

At revision b24126f, the Axios parseHeaders implementation (an
anonymous default export) was missed in favor of an importer.
Fastify kRouteContext is defined as a Symbol object-property key
but references were ranked higher. Fastify Reply had a competing
CommonJS require alias in another file.

Experimental fixes were subsequently added to the same feature branch
to recognize these patterns and suppress structural promotion without
query evidence. **The metrics above do not apply to those later edits.**
Passing tests and CI does not establish new real-model performance.

Since the evaluation cases were used to guide these fixes, they are
now development regression cases, not untouched held-out data.
A future release-grade report should test fresh, independently
labeled implementation-level and negative cases.
