# Search comparison results — 2026-10-28

Protocol: [README.md](README.md). Models were NOT installed into the bot runtime.
50 deduplicated standalone old questions were used for calibration; 48 separately authored questions
were frozen before inference. The same heldout was used for all variants and was not used to tune policies.
This heldout is now exposed: do not tune on it and present it as unseen in a future experiment.

Heldout SHA-256: `967f1d415912ff632f03fac5cee385da20d753f9766cfa1c2ff7b6d50bada382`.
Source/corpus/dataset/heldout hashes matched across all three reports.

| Measurement | E5-small q8 | E5-base q8 | Small + BGE reranker q8 |
|---|---:|---:|---:|
| Expected-route hit@1 before acceptance policy | 29/41 | 34/41 | 37/41 |
| Expected-route hit@5 | 38/41 | 38/41 | 41/41 |
| Expected-route hit@20 | 41/41 | 41/41 | 41/41 |
| Strict successful outcomes after calibrated policy | 24/48 | 7/48 | 27/48 |
| Correct direct answers | 19 | 1 | 21 |
| Wrong direct answers | 1 | 0 | 1 |
| Correct / accepted direct answers | 19/20 | 1/1 | 21/22 |
| Direct-answer coverage | 20/48 | 1/48 | 22/48 |
| Correct rejections on unsupported questions | 5/6 | 6/6 | 6/6 |
| False accepted direct answers on unsupported questions | 0/6 | 0/6 | 0/6 |
| Missing answers when an answer/clarification was expected | 17 | 40 | 20 |
| Query median (warmed) | 7 ms | 20 ms | 2500 ms |
| Query p95 (warmed) | 10 ms | 30 ms | 3889 ms |
| OS peak RSS, whole process | 616 MiB | 903 MiB | 1541 MiB |

Expected-route hit@K counts only the primary `expected` route. It excludes clarification-only and
unsupported cases; mixed expected/clarification cases do not count every acceptable clarification target.
Strict success includes only correct direct answers, appropriate explicit clarifications or correct rejection.
Precision without coverage is misleading: Base almost always rejected rather than providing useful answers.

## Domain breakdown

| Measurement | Small | Base | Small + reranker |
|---|---:|---:|---:|
| Railway expected-route hit@1 | 21/30 | 23/30 | 26/30 |
| Railway strict outcomes | 17/34 | 5/34 | 17/34 |
| Library expected-route hit@1 | 8/11 | 11/11 | 11/11 |
| Library strict outcomes | 7/14 | 2/14 | 10/14 |

The overall strict-outcome gain comes from the library, not demonstrated improvement of the railway bot.
Better ranking is real, but acceptance/clarification policy remains a separate problem.

## Interpretation

- Reranking improved the order of retrieved materials. It did **not** establish 90% end-to-end accuracy.
- Base ranked better than Small with modest extra resources, but its calibrated cutoff transferred poorly
  from the old calibration set to the new questions. Its 7/48 result is not evidence of poor raw retrieval.
- Reranker supplied 21 correct of 22 accepted answers, but rejected 20 answerable cases. This is not enough
  to call it a ready drop-in replacement; the sample is too small to establish precision superiority.
- All-reject baseline succeeds on 6/48 (loss 42); Small/Base/reranker losses were 30/41.5/24.
- Thresholds were frozen from calibration: Small .88/.01, Base .88/.02, reranker sigmoid-score .8/.01.
  Sigmoid scores are not calibrated probabilities of correctness.
- Timing/RSS were measured in fresh local Windows processes on i7-10700K / 32 GB, with 2 inference threads
  and the dev bot in the background. Reranker memory includes both models resident. This is not a VPS SLA.
- Next experiment needs more representative calibration including long questions and missing facts,
  plus a NEW untouched verification set. Do not simply lower thresholds using the exposed heldout.

Detailed ignored artifacts: `.cache/search-benchmark/{small,base,rerank}.json` and `*-policy.json`.
No runtime model, production service, production content or bot token was changed.
