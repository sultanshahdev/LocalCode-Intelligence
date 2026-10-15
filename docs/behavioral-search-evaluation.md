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
