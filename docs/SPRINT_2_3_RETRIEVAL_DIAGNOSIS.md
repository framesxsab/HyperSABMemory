# Sprint 2.3 retrieval diagnosis

Baseline: Windows / Node 22.14.0, 64 indexed TypeScript source/test files plus one forgotten sentinel, 20 answerable queries and 10 no-answer queries. Each indexed record is one repository file, matching the gold file-path grain. All 66 gold paths are indexed and current.

| Candidate rank | Relevant paths found | Recall over 66 gold references |
|---|---:|---:|
| Top 5 | 43 | 0.652 micro |
| Top 20 | 63 | 0.955 micro |
| Top 50 | 66 | 1.000 micro |

There are no indexing misses. All three gold references below rank 20 are still inside the top 50. Before the retrieval changes, 44 relevant references appeared in the top five and 62 in the top 20. The latest raw top-five result is 0.43 precision / 0.652 micro recall, so it still misses the release gates.

The former grounded operation applied an unweighted 0.6 lexical-coverage cutoff only to raw top-five results. That rejected many current gold sources. The new path reads a broader ranked candidate pool, normalizes CamelCase and common inflections, removes common query terms, weights query-token coverage by corpus IDF, checks the captured SHA-256 against current source bytes, and returns a short source excerpt. Only an explicitly backticked code identifier with a matching declaration can produce `SUPPORTED` / `canAssert: true`; investigation queries remain candidate evidence. Conflicts supplied by callers are labeled `caller_declared`; arbitrary source contradiction detection is not claimed.

The final frozen held-out evaluation reports raw precision@5 0.43, macro recall@5 0.667, micro recall@5 0.652, MRR 0.829, and 7/10 no-answer raw candidate returns. Grounded evidence precision@5 is 0.35, macro recall@5 0.546, micro recall@5 0.530, and MRR 0.763. It produces candidate evidence on all 20 answerable queries and 3/10 no-answer queries, but makes 0/20 supported assertions on this investigation-style fixture. The exact-symbol development check verifies one supported declaration. The grounded held-out retrieval gates still fail; zero assertions on the held-out fixture is not a completion pass.

Development calibration uses 21 disjoint examples (11 answerable, ten no-answer), and selects IDF-weighted support 0.3 under a one-per-ten candidate-evidence false-positive budget. Development top-five precision/recall are 0.364 / 0.955; candidate evidence coverage is 11/11 and no-answer candidate evidence is 1/10. The candidate ranking blend grid found no improvement over BM25 order, so no reranker weight was added. This is a small calibration set, not a semantic entailment benchmark.

The exact per-query artifact includes the top-five source paths and BM25 scores, each relevant path's top-50 rank, term evidence, source freshness, weighted coverage, and grounding outcome: [SPRINT_2_3_RETRIEVAL_DIAGNOSIS.json](SPRINT_2_3_RETRIEVAL_DIAGNOSIS.json). Regenerate it with `node scripts/repository-task-diagnose.mjs --write-report`.

Timing on the final held-out operation uses one warmup and five measured calls per query (150 samples), including SHA-256 verification and excerpt selection: p50 188.75 ms, p95 238.74 ms. A separate development-query grounded benchmark uses 64 real source files and synthetic distractors, six queries, one warmup and five samples per query: 500 records p50 148.00 ms / p95 190.71 ms; 10,000 records p50 194.37 ms / p95 225.45 ms. Windows x64, Node 22.14.0. The historical 500/10,000 raw retrieval diagnostic measured p95 4.21 / 78.36 ms with 150 samples each; its precision ceiling is 0.20, so it is not the release quality gate. No persistent cache was added. The grounded performance gate fails.
