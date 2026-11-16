import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { HybridSearchEngine } from '../dist/memory/hybridSearch.js';
import { TemporalMemoryEngine } from '../dist/memory/temporalMemory.js';

const files = {
  'src/parcel.ts': 'export function scheduleParcel(order) { return order.slot; } // parcel scheduling dispatch',
  'tests/parcel.test.ts': 'test("parcel scheduling dispatch", () => scheduleParcel(order));',
  'src/parcelRoute.ts': 'router.post("/parcel", scheduleParcel); // parcel scheduling dispatch',
  'src/parcelLog.ts': 'export function parcelLog() {} // parcel scheduling dispatch audit',
  'docs/parcel.md': 'Parcel scheduling dispatch guide for operators.',
  'src/parcelStats.ts': 'export function parcelStats() {} // parcel scheduling dispatch metrics',
  'src/parcelCache.ts': 'export function parcelCache() {} // parcel scheduling dispatch cache',
  'src/parcelErrors.ts': 'export function parcelErrors() {} // parcel scheduling dispatch errors',
  'src/parcelQueue.ts': 'export function parcelQueue() {} // parcel scheduling dispatch queue',
  'src/billing.ts': 'export function settleInvoice(invoice) { return invoice.total; } // billing settlement',
  'tests/billing.test.ts': 'test("billing settlement", () => settleInvoice(invoice));',
  'src/billingRoute.ts': 'router.post("/billing", settleInvoice); // billing settlement',
  'src/billingLog.ts': 'export function billingLog() {} // billing settlement audit',
  'docs/billing.md': 'Billing settlement guide for operators.',
  'src/billingStats.ts': 'export function billingStats() {} // billing settlement metrics',
  'src/billingCache.ts': 'export function billingCache() {} // billing settlement cache',
  'src/billingErrors.ts': 'export function billingErrors() {} // billing settlement errors',
  'src/billingQueue.ts': 'export function billingQueue() {} // billing settlement queue',
};
const cases = [
  {q:'parcel scheduling dispatch src/parcel.ts implementation test routing', relevant:['src/parcel.ts','tests/parcel.test.ts','src/parcelRoute.ts']},
  {q:'scheduleParcel parcel scheduling dispatch implementation test routing', relevant:['src/parcel.ts','tests/parcel.test.ts','src/parcelRoute.ts']},
  {q:'parcel scheduling dispatch test route', relevant:['src/parcel.ts','tests/parcel.test.ts','src/parcelRoute.ts']},
  {q:'billing settlement src/billing.ts implementation test routing', relevant:['src/billing.ts','tests/billing.test.ts','src/billingRoute.ts']},
  {q:'settleInvoice billing settlement implementation test routing', relevant:['src/billing.ts','tests/billing.test.ts','src/billingRoute.ts']},
  {q:'billing settlement test route', relevant:['src/billing.ts','tests/billing.test.ts','src/billingRoute.ts']},
  {q:'parcel scheduling deployment manifest', relevant:[]},
  {q:'quantum nebula teleportation', relevant:[]},
];
assert.equal(new Set(cases.map(c => c.q)).size, cases.length);
assert(cases.every(c => c.relevant.every(p => Object.hasOwn(files, p))));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-graph-eval-'));
try {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive:true});
    fs.writeFileSync(path.join(root, name), content + '\n');
  }
  fs.mkdirSync(path.join(root, '.hypersabmemory'));
  fs.writeFileSync(path.join(root, '.hypersabmemory/memory_store.json'), JSON.stringify(Object.entries(files).map(([name, content]) => ({id:name, category:'architecture', content, artifacts:[name], status:'active', timestamp:'2026-01-01T00:00:00Z'}))));
  const graphPath = path.join(root, 'graph.json');
  const graph = alternate => ({nodes:Object.keys(files).map(name => ({id:name, name, type:'file', dependencies:name === 'src/parcel.ts' ? (alternate ? ['src/parcelLog.ts','src/parcelStats.ts'] : ['tests/parcel.test.ts','src/parcelRoute.ts']) : name === 'src/billing.ts' ? (alternate ? ['src/billingLog.ts','src/billingStats.ts'] : ['tests/billing.test.ts','src/billingRoute.ts']) : []}))});
  const engine = new HybridSearchEngine(root, new TemporalMemoryEngine(root));
  const run = () => cases.map(c => engine.searchRecordsWithScores(c.q, 100).map(x => x.record.artifacts[0]));
  const noGraph = run();
  fs.writeFileSync(graphPath, JSON.stringify(graph(false)));
  const linked = run();
  fs.writeFileSync(graphPath, JSON.stringify(graph(true)));
  const rewritten = run();
  fs.writeFileSync(graphPath, '{invalid');
  const invalid = run();
  fs.writeFileSync(graphPath, JSON.stringify(graph(false)));
  const restored = run();
  assert.deepEqual(invalid, noGraph);
  assert.deepEqual(restored, linked);
  const measure = results => {
    const answerable = cases.map((c,i) => ({...c, results:results[i]})).filter(c => c.relevant.length);
    const hits = c => new Set(c.results.slice(0,5).filter(p => c.relevant.includes(p))).size;
    return {
      rawP5:answerable.reduce((s,c) => s + hits(c)/5,0)/answerable.length,
      macroRecall5:answerable.reduce((s,c) => s + hits(c)/c.relevant.length,0)/answerable.length,
      meanCandidateCount:answerable.reduce((s,c) => s + c.results.length,0)/answerable.length,
      noAnswerQueriesWithCandidates:cases.filter((c,i) => !c.relevant.length && results[i].length).length,
      noAnswerCandidateCounts:cases.flatMap((c,i) => c.relevant.length ? [] : [results[i].length]),
    };
  };
  const changed = (a,b,n) => a.filter((r,i) => r.slice(0,n).join() !== b[i].slice(0,n).join()).length;
  console.log(JSON.stringify({method:{answerableCases:cases.filter(c => c.relevant.length).length, noAnswerCases:cases.filter(c => !c.relevant.length).length, documents:Object.keys(files).length, relevanceUnit:'source path', precisionCeiling:cases.filter(c => c.relevant.length).reduce((s,c) => s + Math.min(c.relevant.length,5)/5,0)/cases.filter(c => c.relevant.length).length, candidateLimit:100, synthetic:true, humanIndependent:false, labelsPreviouslyObserved:true}, noGraph:measure(noGraph), linked:measure(linked), rewritten:measure(rewritten), graphEffect:{changedTopFive:changed(noGraph,linked,5), changedFullRanking:changed(noGraph,linked,100)}, rewrites:{changedTopFive:changed(linked,rewritten,5), changedFullRanking:changed(linked,rewritten,100), invalidMatchesNoGraph:true, restoredMatchesOriginal:true}},null,2));
} finally { fs.rmSync(root, {recursive:true, force:true}); }
