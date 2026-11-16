# Sprint 2.7 — retrieval usefulness

## Sprint 2.7 closeout after later changes

The frozen evaluator was rerun before Sprint 2.8 implementation on Windows x64 / Node 22.14.0, without changing its labels, questions, or scoring rules. `node scripts/repository-task-eval.mjs` exited 1: raw P@5 **0.500**, macro recall@5 **0.770833**; grounded P@5 **0.450**, macro recall@5 **0.691667**. It reported **0/20 supported answerable assertions**, **0/10 unsupported no-answer assertions**, zero forgotten-record leaks, and zero stale evidence/assertion leaks across 20 same-size source-mutation probes. End-to-end grounded evaluation latency was p50 **40.43 ms**, p95 **58.43 ms**, over 150 samples; this is not the 10,000-record benchmark.

Raw precision meets 0.50 exactly, but raw recall, grounded precision and grounded recall remain below their release gates; broad answer support remains zero. **Release remains NO-GO.** These labels had been observed previously, so this rerun is a closeout/regression measurement, not fresh blind validation. The prior results below remain historical and are not replaced by this run.

**Recommendation: NO-GO.** Implementation and validation are local Windows x64 / Node 22.14.0. Work remains uncommitted in `C:/Users/singa/Desktop/hypermemory-sprint2.5`, branch `feature/sprint2.5-20261106`, based on `592f054acb5409d3ee93bc4eb2e7fdeb581fa9fa`. Maintenance worktrees were not modified. No push, merge, publication, or release was performed.

## Root causes and baseline

The unchanged Sprint 2.5 development fixture has 11 answerable and ten no-answer questions, with 56 relevant query/source pairs. The fresh pre-implementation run reported raw P@5 0.563636, macro recall@5 0.562121; grounded P@5 0.490909, macro recall@5 0.480303; zero supported answerable assertions, zero unsupported no-answer assertions, zero forgotten-record leaks, and zero stale leaks in 11 same-size rewrite probes. Development latency p50/p95 was 49.50/154.60 ms. These labels are manually authored and not independently human-reviewed.

All 56 relevant pairs were indexed and appeared in the top 50: zero indexing or candidate-generation misses. Twenty-five ranked 6–50. Grounding emitted 27 relevant pairs; diagnostics classified 25 as below lexical eligibility and four as beyond the first five eligible sources. These counts overlap ranking losses, and diagnostic threshold classifications do not prove the source was actually inspected before early stopping. All 11 broad answerable questions abstained because the assertion rules verify narrow declarations, exact quotations and JSON values, not general explanations. Passage correctness is not labeled by this fixture and cannot be inferred from a correct file path.

| Development question | Relevant paths | Raw top five | Rank 6–50 | Relevant grounded | Below threshold | Five-entry limit |
|---|---:|---:|---:|---:|---:|---:|
| Task creation, hashes and MCP capsule | 5 | 4 | 1 | 4 | 0 | 1 |
| Setup, seeding, adapters and MCP | 6 | 1 | 5 | 1 | 3 | 2 |
| Source containment and rewrites | 4 | 3 | 1 | 1 | 3 | 0 |
| MCP context, active file and graph | 5 | 3 | 2 | 3 | 2 | 0 |
| JSON persistence and hybrid search | 6 | 4 | 2 | 4 | 2 | 0 |
| Forgotten and superseded filtering | 5 | 2 | 3 | 2 | 3 | 0 |
| Rollback, checkpoints and ghost paths | 5 | 4 | 1 | 4 | 0 | 1 |
| MCP claims and process ownership | 5 | 3 | 2 | 3 | 2 | 0 |
| Revision fencing and crash recovery | 5 | 4 | 1 | 4 | 1 | 0 |
| Watcher, checkpoints and noisy paths | 5 | 2 | 3 | 0 | 5 | 0 |
| Documented architecture boundaries | 5 | 1 | 4 | 1 | 4 | 0 |

Concrete misses include setup dependencies such as `universalAdapters.ts` and `seeding.ts`, and watcher sources rejected despite raw top-five matches. All questions require multiple files. Freshness/containment/hash conflicts were not the cause of the clean-source quality misses; separate mutation and conflict tests exercise those rejection paths.

## Implementation

- `src/memory/hybridSearch.ts`: static relative import/re-export hints rerank existing lexical candidates using their relationship to the top three baseline results. The development probe supported a 0.5 relationship contribution; it gained three relevant paths without a raw per-query hit-count regression. Exact path and identifier priorities remain ahead of that score. The parser skips comments and string/template examples, supports ordinary multiline declarations, and intentionally ignores declarations longer than 4,096 characters. Hints are cached by workspace and exact record text with a bounded key budget. They describe indexed snapshots and are not proof of current source dependencies.
- `src/memory/groundedSearch.ts`: natural questions consider at least ten ranked candidates, continuing farther when needed to obtain five eligible sources. A bounded reciprocal-rank/support blend chooses five current sources without lowering the existing 0.3 eligibility threshold. Explicit assertion rules and final source rehashes remain intact. Code excerpts prioritize actual declarations of queried identifiers over earlier comments/import mentions and retain at most three excerpt lines.
- `src/mcp/taskTools.ts`: natural task questions inspect captured sources and rank bounded source excerpts alongside active memories. A response-only source candidate is added when existing memories do not cover the excerpt's query terms. No duplicate persistent memory is required. Snippet-derived IDF is not used to judge full-source lexical coverage; such evidence remains non-assertive. Source conflicts, containment, current hashes, and fresh active-store reads are preserved.
- Regression coverage was added in `tests/hybridSearch.test.ts`, `tests/groundedSearch.test.ts`, and `tests/taskProcesses.test.ts`. `scripts/package-smoke.mjs` exercises the installed package after process restart. `README.md` and `Architecture.md` describe the new behavior and its limits.

## Controlled quality comparison

Reproducible evaluation artifacts added for this sprint are `scripts/sprint27-controlled-dev-eval.mjs`, `scripts/sprint27-relationship-probe.mjs`, `scripts/sprint27-evidence-probe.mjs`, `scripts/sprint27-diversity-probe.mjs`, and `scripts/sprint27-blind-agent-eval.mjs`. Production changes are limited to the three source files listed above; the existing package smoke and three test files were extended. Documentation changes include this report, its aggregate JSON evidence, `README.md`, `Architecture.md`, `Phases.md`, and project `Memory.md`.

`scripts/sprint27-controlled-dev-eval.mjs` compares both algorithms over one identical current source snapshot and the unchanged development queries/labels. It reconstructs the prior ranker by disabling import hints and reproduces its first-five eligible-source selection. This complements the actual pre-change run: because the repository itself is the corpus, editing source files otherwise changes the indexed text between runs. Precision always divides by five; the answerable population and relevance labels are unchanged.

| Metric | Baseline | Candidate | Relative change | 20% target |
|---|---:|---:|---:|---:|
| Raw P@5 | 0.563636 | 0.618182 | +9.68% | 0.676364 |
| Raw macro recall@5 | 0.562121 | 0.610606 | +8.63% | 0.674545 |
| Grounded P@5 | 0.490909 | 0.490909 | 0.00% | 0.589091 |
| Grounded macro recall@5 | 0.480303 | 0.480303 | 0.00% | 0.576364 |

Supported assertions on broad development questions remain zero; unsupported no-answer assertions remain zero. Raw no-answer candidate returns remain 8/10. The quality target is missed. These source-path metrics do not measure passage correctness or semantic entailment.

## Workflow evidence

The installed local tarball smoke scenario starts two independent MCP clients, creates and checkpoints a task, fences a stale owner, closes the processes, and restores the same task in a fresh process. It checks a symbol definition, a JSON configuration value from an unindexed captured file, the recorded architectural decision's exact source text, a separate source quotation, and natural implementation/test evidence. Missing answers must return `INSUFFICIENT_EVIDENCE` with `canAssert: false`; conflicting captured/checkpoint hashes must return `CONFLICTING_EVIDENCE`. Natural explanations return traceable candidate excerpts while abstaining from semantic assertions. No actual IDE/model agent or productivity comparison is claimed.

## Validation status

The implementation was frozen before the following final runs. Frozen labels were not used for development or threshold selection. Aggregate machine-readable evidence is retained in `docs/SPRINT_2_7_EVIDENCE.json`.

- `npm.cmd test`: **239 tests passed in 36 files**, including a build.
- `npx.cmd tsc --noEmit`: passed.
- `npm.cmd run eval`: eight tests passed.
- `npm.cmd run package:smoke`: passed after packing and installing the local tarball, running the MCP workflow described above, and safe removal. All four deterministic questions (symbol, configuration, decision text, quotation) were supported; natural implementation/test retrieval returned both expected files with semantic abstention; the missing question abstained; conflicting hashes blocked assertions. No incorrect deterministic assertion was observed in this scenario.
- `node scripts/sprint27-controlled-dev-eval.mjs`: passed its controlled comparison; metrics are shown above.
- `node scripts/sprint25-development-eval.mjs`: completed; final metrics equal the candidate column above. Zero forgotten leaks, zero unsupported no-answer assertions, and zero stale leaks in 11 probes. Development latency p50/p95 was 63.65/135.73 ms.
- `node scripts/grounded-benchmark.mjs 500` and `node scripts/grounded-benchmark.mjs 10000`: completed with the measurements below.
- `node scripts/repository-task-eval.mjs`: completed once after freeze, **exit 1** because release gates fail.
- `node scripts/sprint27-blind-agent-eval.mjs`: completed after freeze, exit 0; this means the harness ran, not that quality passed.
- `git diff --check`: passed. HEAD remained unchanged. Remote CI and registry-based npx resolution were not tested.

## Performance

| Records | Warm before p50/p95 ms | Warm after p50/p95 ms | Independent-process before p50/p95 ms | Independent-process after p50/p95 ms |
|---|---:|---:|---:|---:|
| 500 | 36.45 / 56.64 | 54.25 / 73.73 | 86.73 / 106.65 | 126.46 / 136.07 |
| 10,000 | 72.01 / 100.15 | 100.74 / 122.12 | 179.65 / 243.21 | 217.08 / 306.98 |

At 10,000 records, final stage p50/p95 was candidate preparation 47.91/60.47 ms, indexing 30.70/43.05 ms (included in candidate time), ranking 5.32/32.35 ms, and grounding 41.19/52.63 ms. Path inspection alone was 20.56/24.99 ms. Candidate preparation remains the largest median stage; additional source verification and relationship ranking also cost time. Percentiles of stages cannot be added.

The approximately 83.5 ms warm target is missed. Both benchmark scripts use synthetic distractors and six development queries; warm distributions have 30 samples, and independent-process distributions only six. Process startup and reference capture are excluded from the latter. Hardware and scripts were unchanged, but machine load was not controlled, and source contents changed as the implementation evolved. These runs establish the observed regression and uncertainty, not a precise causal estimate or stable production percentile. Correctness checks were retained.

## Frozen evaluation after freeze

Frozen labels were untouched. The 20 answerable and ten no-answer cases returned raw P@5 **0.490**, macro recall@5 **0.754167**, grounded P@5 **0.360**, and grounded macro recall@5 **0.562500**. Supported answerable assertions remained **0/20**; unsupported no-answer assertions were **0/10**. Forgotten-record leaks were zero. Twenty same-size source-mutation probes were flagged, with zero stale evidence/assertion leaks. Frozen latency p50/p95 was 48.97/112.32 ms.

All precision/recall release gates fail. For historical context only, Sprint 2.5 reported 0.470/0.725 raw and 0.340/0.529167 grounded; this is not a controlled Sprint 2.6 before/after comparison because the current Sprint 2.6 frozen state was not measured immediately before this sprint. The controlled development comparison remains the basis for the reported relative changes.

## Separate agent-authored evaluation

A separate agent authored five synthetic MCP task cases without inspecting the implementation or development labels; its script was first run after implementation freeze. It is not human-reviewed, and its labels have now been observed. Among the three non-stale answerable cases, returned relevant evidence paths were 0/4 for invoice renewal, 1/4 for upload expiry, and 3/3 for digest scheduling. Using the same five-slot precision denominator gives grounded P@5 **0.266667** and macro recall **0.416667**. These five cases are a separate population and are not merged into development or frozen scores.

All cases abstained from assertions. The missing encryption answer returned no evidence. The stale expiry case flagged the modified source and did not return it as current evidence. The digest case returned conflicting implementation/documentation sources but did not identify their semantic contradiction: its status was `INSUFFICIENT_EVIDENCE`, not `CONFLICTING_EVIDENCE`. Hash conflicts are detected; arbitrary semantic contradictions remain unresolved. This evaluation exposes substantial natural-question retrieval failures despite the successful explicit smoke scenario.

## Remaining failures and next step

### Batch source-inspection continuation

Metadata restoration and final evidence rechecks now reuse the existing source inspector's resolved workspace root for each batch. Each individual source still undergoes ancestor/symlink containment checks, a fresh read and SHA-256 calculation. Metadata-only batches process one file at a time and omit all returned file bytes; the existing missing-capture warning is preserved. Regression coverage compares mixed current, same-size modified, missing, unverified and escaping paths and checks an inside junction replaced with an outside junction.

A 10,000-record before/after run measured path-stage p50/p95 **19.55/24.80 -> 17.18/22.57 ms**, warm p50/p95 **99.74/121.57 -> 93.20/124.68 ms**, and independent-process p50/p95 **253.37/322.46 -> 238.72/292.83 ms**. The warm p95 did not improve; these small synthetic samples support eliminating repeated work, not a performance-gate pass. The source checks were retained.

The first full run then passed 241 of 242 tests but timed out in the existing 20-second repository-evaluation test; the same test also timed out in isolation at 21.42 seconds. The timeout was not increased. Grounding now reuses query-independent source token sets keyed by workspace and freshly verified SHA-256, with an 8 MiB input/key budget. Reads, hashes, containment checks and final evidence rechecks still execute. Tests verify different questions against one source and a same-size rewrite with old and refreshed hashes.

After that change, `npm.cmd test` passed **243 tests in 36 files** with its normal worker count and unchanged timeouts. Typecheck, eight evaluation tests, installed-package MCP smoke, development evaluation, both grounded benchmarks and `git diff --check` passed. Development raw P@5/recall remained 0.636364/0.625758 and grounded 0.581818/0.569697; unsupported assertions, forgotten leaks and stale leaks remained zero. No frozen or observed blind cases were used to tune this continuation.

The latest general 10,000-record warm p50/p95 was **106.46/146.92 ms**, independent-process **245.24/318.87 ms**, and grounding **39.27/55.60 ms**. This run did not show an end-to-end latency improvement over the prior small sample. A separate interleaved same-file probe disabled only the source-token cache in an in-memory baseline: five 57,000-byte synthetic source files, six samples per variant after warmup, identical five-source evidence and no assertions. Its p50/p95 was **57.48/68.02 ms** without reuse versus **43.87/57.31 ms** with reuse. This establishes a benefit for that workload, not a stable general performance percentile. Quality and latency release targets remain unmet.

### Vocabulary normalization continuation

The production tokenizer now uses the standard Porter algorithm from pinned MIT dependency `stemmer@2.0.1` ([upstream documentation](https://github.com/words/stemmer)). This replaces the earlier plural-only normalization; it is not a query-specific synonym list. `validate`/`validation`, `restore`/`restoration`, and `implement`/`implementation` now share stems. Not every related pair is joined: for example, this algorithm does not join `create` and `creation`. Original strings still govern exact path/identifier priority and deterministic assertions. Common query words and tokens containing digits are preserved. The pure word cache is limited to 8,192 entries and memoizes only words up to 128 characters; longer inputs are still processed.

The temporary-install prototype was evaluated before changing project dependencies. Its initial paired result was raw P@5/recall 0.618/0.611 to 0.655/0.648 and grounded 0.491/0.480 to 0.582/0.570. The repository corpus subsequently changed during implementation, so those prototype numbers are not substituted for the final paired comparison. A post-adoption probe invocation initially reused the production scorer as its baseline; the probe was corrected to reconstruct both the legacy tokenizer and its grounder before recording the final results.

The final same-snapshot comparison (`node scripts/sprint27-stemming-probe.mjs node_modules/stemmer/index.js`) uses the same 72 files, 11 answerable questions, ten no-answer questions, labels, and five-slot precision denominator for both algorithms. Legacy versus Porter: raw P@5 **0.618182 -> 0.636364** (+2.94%), raw macro recall **0.610606 -> 0.625758** (+2.48%), grounded P@5 **0.509091 -> 0.581818** (+14.29%), and grounded macro recall **0.503030 -> 0.569697** (+13.25%). The current legacy grounded baseline differs from the earlier report because the indexed source text changed; the paired snapshot is the valid comparison for this continuation. Aggregate evidence and per-query counts are retained in `docs/SPRINT_2_7_STEMMING_EVIDENCE.json`.

The final development run returns 35 relevant raw paths and 32 relevant grounded paths out of 56 labels. Raw no-answer candidate returns increased from 8/10 to 10/10, and current no-answer evidence returns are 4/10 rather than the earlier 1/10. Supported broad answer assertions remain zero; unsupported no-answer assertions, forgotten-record leaks, and stale leaks in 11 mutation probes remain zero. This is a relevance gain with a measured noise regression, not semantic verification. The 20% goal is still missed.

Validation: `npm.cmd test` passed 241 tests in 36 files, typecheck and the eight-test evaluation suite passed, the installed-tarball smoke passed, and the production audit found zero vulnerabilities. After adding the memoization word-length bound, the 47 focused retrieval/grounding/process tests, typecheck, installed-package smoke, development evaluation, both benchmarks, and `git diff --check` passed. The old tokenizer-equivalence test was replaced with explicit expected action-form, identifier-splitting, numeric-token and long-word behavior; exact assertion/freshness tests remain intact. No frozen or observed blind fixture was used to tune or revalidate this continuation.

Latest benchmark: 500-record warm p50/p95 **59.47/85.60 ms**, independent-process **142.50/206.95 ms**; 10,000-record warm **102.67/138.59 ms**, independent-process **231.98/291.58 ms**. The earlier pre-stemming final 10,000-record warm p95 was 122.12 ms. Source verification was retained, but the performance target remains unmet and the latest run regressed. These small synthetic samples do not establish a stable production percentile. Release remains **NO-GO**.

Post-freeze usability continuation: complete symbol-definition questions now accept unquoted names, optional function/class wording, and empty call parentheses. The same contained-source/hash/declaration verifier is used. Compound and negated questions abstain instead of allowing a symbol subphrase to authorize a broader assertion. Identifier boundaries were corrected so a declaration of `Widget$` cannot support an assertion about `Widget`, while `Widget$` itself can be verified. Source changes still invalidate assertions.

For this continuation, `npm.cmd test` passed **241 tests in 36 files**; typecheck, the eight-test evaluation suite, installed-tarball MCP smoke (including the ordinary function question after restart), development evaluation, and `git diff --check` passed. Development metrics remained raw P@5/recall 0.618182/0.610606 and grounded 0.490909/0.480303; its 11 stale probes leaked zero evidence, forgotten-record leaks and unsupported no-answer assertions were zero. No frozen or blind fixture was reused to develop the parser; the earlier frozen and latency results do not measure this later code. The 20% target remains unmet.

A subsequent ranking-preserving term-frequency cache experiment was rejected. In one 10,000-record before/after comparison, warm p50/p95 changed from 94.55/109.37 ms to 95.46/137.38 ms, candidate p50/p95 from 45.35/55.15 ms to 46.99/64.30 ms, and independent-process p50/p95 from 218.16/260.07 ms to 238.94/287.73 ms. The production change was removed. Numeric regression coverage was retained for BM25 repeated-term scoring and warm-cache reuse. These small samples reject this candidate; they do not isolate the remaining allocation/cache-key costs.

A subsequent Node CPU profile localized 290 of 532 sampled ticks in the candidate-preparation callback to the token-cache lookup line, versus 90 on query-term membership and 64 on phrase matching. The profile includes fresh-engine calls; subprocess waiting is excluded from this interpretation. A two-level content/metadata cache candidate measured warm p50/p95 99.16/108.98 ms and cold p50/p95 221.24/316.80 ms in one run. This did not establish a warm improvement over the earlier 94.55/109.37 ms run and worsened its cold p95. It was removed. A regression test was retained for shared record content with distinct tags and same-size metadata rewrites. The profile narrows the next investigation but does not prove that cache-key hashing alone causes the measured latency.

The 20% quality target was missed, grounded development precision/recall did not improve, the performance target was missed, frozen release gates fail, and broad explanation assertions remain unsupported. The local implementation provides useful source recovery and better raw ranking, but does not establish reliable general retrieval or productivity gains. Recommendation remains **NO-GO**.

The next implementation should address broad-query source coverage and passage relevance using separately reviewed development cases. Highest-priority observed examples are unindexed natural task sources with synonym/role wording, setup dependencies below the top five, and files rejected by lexical eligibility despite structural relevance. Semantic contradiction detection requires an explicit verified rule or external validation; it must not be simulated by lexical scoring. Further tuning must not use the now-observed frozen or separate-agent cases as a new development set.
