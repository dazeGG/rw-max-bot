# Local retrieval experiment (2026-10-28)

This CLI does not change the live/dev bot model, query a production database, or send MAX messages.
Models download once into the existing ignored `.cache/e5`; reports go into `.cache/search-benchmark`.

## Frozen protocol

- Compare E5-small q8, E5-base q8, and E5-small + BGE-reranker-v2-m3 q8 in separate fresh Node processes.
- Model revisions are pinned in `cli/benchmark-search.ts`. No model weights are committed.
- Both corpora, passage builder and query preprocessing are identical. Embeddings have 384/768 dimensions.
- Rerank the first 20 **nodes**, using each node's best E5-small content passage. Strip only `passage: `.
  Do not replace the passage with a whole truncated document or an option label.
- Calibration uses only deduplicated first turns of the original scenarios; follow-ups are not detached.
- New heldout: 48 standalone questions, including a separate library domain, ambiguous questions,
  out-of-domain requests and in-domain questions lacking facts in the corpus.
- Frozen heldout SHA-256: `967f1d415912ff632f03fac5cee385da20d753f9766cfa1c2ff7b6d50bada382`.
- The threshold/gap grid and loss are defined in `benchmark-policy.ts` before heldout scoring.
  Loss: wrong direct answer 4, missing answer 1, irrelevant clarification 1.5, unnecessary clarification .75.
  Correct answers/clarifications/rejections cost 0. Ties: fewer wrong answers, more correct direct answers,
  smaller ambiguity gap, then higher threshold. The all-reject baseline is included explicitly.
- Reranker uses independent sigmoid-transformed single logits, **not softmax** and not calibrated probabilities.
- Persist each calibrated policy before heldout inference. Do not modify labels/policies from heldout outcomes.
- Report retrieval only on answerable examples; report decision accuracy, accepted-answer precision,
  coverage and false acceptance of unsupported questions separately.
- CPU only, 2 inference threads, embedding batch 8, reranker batch 2, tokenizer limit 512.
  Warm up on two calibration queries, then two heldout timing passes in a fixed shuffled order (seed 42).
- Record load/index times separately, query p50/p95, sampled RSS every 25 ms and OS peak RSS if available.
  The reranker process keeps both models resident. A sampled peak is not an exact maximum.
- Current host is a desktop i7-10700K / 32 GB, with the dev bot in the background.
  These measurements do not establish latency or safe RAM headroom on the 2-vCPU production VPS.

## Reproduce

```sh
pnpm benchmark:search --variant=small
pnpm benchmark:search --variant=base
pnpm benchmark:search --variant=rerank
pnpm benchmark:search --report
```

The report command rejects mismatched source, corpus or dataset hashes. No winner is automatically integrated.
