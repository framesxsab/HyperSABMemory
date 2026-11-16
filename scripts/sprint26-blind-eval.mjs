import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { captureTaskSources } from '../dist/harness/taskSources.js';
import { HybridSearchEngine } from '../dist/memory/hybridSearch.js';
import { TemporalMemoryEngine } from '../dist/memory/temporalMemory.js';
import { searchGrounded } from '../dist/memory/groundedSearch.js';

// Cases and relevance judgments were authored before running retrieval; this is not a human-independent benchmark.
const files = {
  'src/cart.ts': 'export function reserveBasket(stock, quantity) { if (stock < quantity) throw new Error("shortage"); return stock - quantity; }\n',
  'src/refunds.ts': 'export function refundPayment(payment) { return payment.reverse(); }\n',
  'src/routes.ts': 'router.post("/checkout", checkoutHandler);\nrouter.get("/health", healthHandler);\n',
  'tests/cart.test.ts': 'test("basket rejects shortage", () => expect(() => reserveBasket(1, 2)).toThrow());\n',
  'tests/refunds.test.ts': 'test("refund reverses payment", () => refundPayment(payment));\n',
  'docs/install.md': 'Installation requires Node 20. Run npm install and npm start.\n',
  'docs/operations.md': 'The nightly backup runs at 02:00 UTC and keeps seven copies.\n',
  'docs/policy-old.md': 'Refunds expire after thirty days.\n',
  'docs/policy-new.md': 'Refunds expire after sixty days.\n',
  'src/legacy.ts': 'export function legacyVoucher() { return "discount"; }\n',
  'src/removed.ts': 'export function removedInvoice() { return "invoice"; }\n',
  'src/renamed.ts': 'export function renamedDispatch() { return "dispatch"; }\n',
  'src/tax.ts': 'export function calculateTax(subtotal) { return subtotal * 0.08; }\n',
  'tests/tax.test.ts': 'test("tax calculation", () => expect(calculateTax(100)).toBe(8));\n',
  'docs/security.md': 'Operators rotate signing keys every ninety days.\n',
  'src/session.ts': 'export function createSession(user) { return { user }; }\n',
};
const cases = [
  {kind:'implementation', q:'Which file defines `reserveBasket`?', relevant:['src/cart.ts']},
  {kind:'implementation', q:'Where is `calculateTax` defined?', relevant:['src/tax.ts']},
  {kind:'implementation', q:'Which code reverses a payment?', relevant:['src/refunds.ts']},
  {kind:'test', q:'Which test checks an inventory shortage?', relevant:['tests/cart.test.ts']},
  {kind:'test', q:'Find the test for calculating tax', relevant:['tests/tax.test.ts']},
  {kind:'routing', q:'Where is the checkout POST endpoint registered?', relevant:['src/routes.ts']},
  {kind:'routing', q:'Find the health check HTTP route', relevant:['src/routes.ts']},
  {kind:'documentation', q:'How do I install and start the application?', relevant:['docs/install.md']},
  {kind:'documentation', q:'How long are nightly backups retained?', relevant:['docs/operations.md']},
  {kind:'documentation', q:'How often should signing keys be rotated?', relevant:['docs/security.md']},
  {kind:'no_answer', q:'Where is the Kubernetes deployment manifest?', relevant:[]},
  {kind:'no_answer', q:'Which module implements email delivery?', relevant:[]},
  {kind:'no_answer', q:'What is the customer loyalty points multiplier?', relevant:[]},
  {kind:'conflict', q:'How many days until refunds expire?', relevant:['docs/policy-old.md','docs/policy-new.md'], conflicts:['docs/policy-old.md','docs/policy-new.md']},
  {kind:'stale', q:'Which file defines `legacyVoucher`?', relevant:['src/legacy.ts']},
  {kind:'stale', q:'Where is `removedInvoice` defined?', relevant:['src/removed.ts']},
  {kind:'stale', q:'Where is `renamedDispatch` defined?', relevant:['src/renamed.ts']},
];
assert.equal(new Set(cases.map(c => c.q)).size, cases.length);
assert(cases.every(c => c.relevant.every(p => Object.hasOwn(files, p))));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-blind-'));
try {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive:true});
    fs.writeFileSync(path.join(root, name), content);
  }
  const refs = captureTaskSources(root, Object.keys(files));
  assert.equal(refs.length, Object.keys(files).length);
  fs.mkdirSync(path.join(root, '.hypersabmemory'), {recursive:true});
  fs.writeFileSync(path.join(root, '.hypersabmemory', 'memory_store.json'), JSON.stringify(Object.entries(files).map(([name, content]) => ({id:name, category:'architecture', content, artifacts:[name], status:'active', timestamp:'2026-01-01T00:00:00.000Z'}))));
  fs.writeFileSync(path.join(root,'src/legacy.ts'), 'export function modernVoucher() { return "discount"; }\n');
  fs.unlinkSync(path.join(root,'src/removed.ts'));
  fs.renameSync(path.join(root,'src/renamed.ts'), path.join(root,'src/dispatch.ts'));
  const engine = new HybridSearchEngine(root, new TemporalMemoryEngine(root));
  const totals = {answerable:0, rawHits:0, rawPrecisionSum:0, rawRecallSum:0, groundedHits:0, groundedPrecisionSum:0, groundedRecallSum:0, noAnswer:0, noAnswerCandidates:0, noAnswerAssertions:0, stale:0, staleDetected:0, staleEvidenceLeaks:0, staleAssertionLeaks:0, declaredConflicts:0, declaredConflictRecognized:0, undeclaredConflictRecognized:0, assertions:0, correctAssertions:0};
  const byKind = {};
  for (const c of cases) {
    const raw = engine.searchRecordsWithScores(c.q, 5).flatMap(x => x.record.artifacts ?? []).slice(0,5);
    const result = searchGrounded(engine, root, c.q, refs, c.conflicts ?? []);
    const grounded = result.evidence.map(x => x.source.path);
    const relevant = new Set(c.relevant);
    const count = list => new Set(list.filter(p => relevant.has(p))).size;
    const bucket = byKind[c.kind] ??= {cases:0, rawHit:0, groundedHit:0};
    bucket.cases++; bucket.rawHit += +(count(raw)>0); bucket.groundedHit += +(count(grounded)>0);
    if (c.kind !== 'no_answer' && c.kind !== 'stale') {
      totals.answerable++; totals.rawHits += +(count(raw)>0); totals.rawPrecisionSum += count(raw)/5; totals.rawRecallSum += count(raw)/relevant.size;
      totals.groundedHits += +(count(grounded)>0); totals.groundedPrecisionSum += count(grounded)/5; totals.groundedRecallSum += count(grounded)/relevant.size;
    }
    if (c.kind === 'no_answer') { totals.noAnswer++; totals.noAnswerCandidates += +(result.candidates.length>0); totals.noAnswerAssertions += +result.canAssert; }
    if (c.kind === 'stale') { totals.stale++; totals.staleDetected += +result.staleSources.some(s => relevant.has(s.path)); totals.staleEvidenceLeaks += result.evidence.filter(e => relevant.has(e.source.path)).length; totals.staleAssertionLeaks += result.assertions.filter(a => relevant.has(a.sourcePath)).length; }
    if (c.conflicts) { totals.declaredConflicts++; totals.declaredConflictRecognized += +(result.status === 'CONFLICTING_EVIDENCE' && !result.canAssert); totals.undeclaredConflictRecognized += +(searchGrounded(engine, root, c.q, refs).status === 'CONFLICTING_EVIDENCE'); }
    totals.assertions += result.assertions.length;
    totals.correctAssertions += result.assertions.filter(a => relevant.has(a.sourcePath) && c.kind !== 'stale' && c.kind !== 'no_answer' && c.kind !== 'conflict').length;
  }
  const n=totals.answerable;
  console.log(JSON.stringify({method:{cases:cases.length, documents:Object.keys(files).length, synthetic:true, manuallyAuthored:true, humanIndependent:false, pAt5Denominator:5, relevanceUnit:'source path', staleMutations:['modified','deleted','renamed']}, answerable:{count:n, rawHitRate:totals.rawHits/n, rawP5:totals.rawPrecisionSum/n, rawMacroRecall5:totals.rawRecallSum/n, groundedHitRate:totals.groundedHits/n, groundedP5:totals.groundedPrecisionSum/n, groundedMacroRecall5:totals.groundedRecallSum/n}, noAnswer:{cases:totals.noAnswer, withCandidates:totals.noAnswerCandidates, withAssertions:totals.noAnswerAssertions}, stale:{cases:totals.stale, detected:totals.staleDetected, evidenceLeaks:totals.staleEvidenceLeaks, assertionLeaks:totals.staleAssertionLeaks}, conflicts:{cases:totals.declaredConflicts, declaredRecognized:totals.declaredConflictRecognized, undeclaredRecognized:totals.undeclaredConflictRecognized}, assertions:{total:totals.assertions, correctSource:totals.correctAssertions}, byKind},null,2));
} finally { fs.rmSync(root,{recursive:true,force:true}); }