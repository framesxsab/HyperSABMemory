import { runRepositoryTaskEvaluation } from '../dist/eval/repositoryTaskEvaluation.js';
import { SPRINT25_DEVELOPMENT } from '../dist/eval/sprint25DevelopmentFixture.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

if (process.argv[2] === '--atomic') {
  const artifact = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const split = process.argv[4];
  if (!['tuning', 'validation'].includes(split)) throw new Error('Select tuning or validation');
  const root = process.argv[5] ?? process.cwd();
  const actualFiles = ['Architecture.md'];
  const walk = relative => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && name.endsWith('.ts')) actualFiles.push(name);
    }
  };
  walk('src'); walk('tests');
  if (JSON.stringify(actualFiles.sort()) !== JSON.stringify(Object.keys(artifact.snapshotFiles).sort())) throw new Error('Snapshot file set mismatch');
  for (const [filename, expected] of Object.entries(artifact.snapshotFiles)) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(root, filename))).digest('hex');
    if (actual !== expected) throw new Error(`Snapshot mismatch: ${filename}`);
  }
  const cases = artifact[split];
  const tasks = cases.map(item => ({ query: item.question, relevantPaths: [...new Set((item.claims ?? []).flatMap(claim => claim.evidence.map(source => source.path)))] }));
  const report = runRepositoryTaskEvaluation(root, true, true, tasks);
  const output = cases.map((item, index) => {
    const result = report.results[index];
    const claims = (item.claims ?? []).map(claim => {
      const sources = claim.evidence.map(source => {
        const bytes = fs.readFileSync(path.join(root, source.path));
        if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Evidence changed: ${source.path}`);
        const actual = bytes.toString('utf8').split(/\r?\n/).slice(source.start_line - 1, source.end_line);
        if (JSON.stringify(actual) !== JSON.stringify(source.lines)) throw new Error(`Evidence lines changed: ${source.path}`);
        const entry = result.grounded.evidence.find(evidence => evidence.source.path === source.path && evidence.source.status === 'current');
        const excerptLines = (entry?.excerpt ?? '').split(/\r?\n/).map(line => line.trim());
        const required = source.lines.map(line => line.trim()).filter(Boolean);
        return { path: source.path, fileRetrieved: result.returnedIds.includes(source.path), groundedSource: Boolean(entry), exactSpanRetained: required.length > 0 && required.every(line => excerptLines.includes(line)) };
      });
      return { claim: claim.text, fileCovered: sources.every(source => source.fileRetrieved), groundedSpanCovered: sources.every(source => source.exactSpanRetained), sources };
    });
    return { id: item.id, answerable: item.answerable, claims, allClaimsFileCovered: claims.length > 0 && claims.every(claim => claim.fileCovered), allClaimsGroundedSpanCovered: claims.length > 0 && claims.every(claim => claim.groundedSpanCovered), canAssert: result.grounded.canAssert, assertionCount: result.grounded.assertions.length };
  });
  console.log(JSON.stringify({ split, labelProvenance: artifact.provenance[split], fileMetrics: report.retrieval, groundedFileMetrics: report.grounded, staleProbe: report.staleProbe, claims: { total: output.flatMap(item => item.claims).length, fileCovered: output.flatMap(item => item.claims).filter(claim => claim.fileCovered).length, groundedSpanCovered: output.flatMap(item => item.claims).filter(claim => claim.groundedSpanCovered).length, completeFileQuestions: output.filter(item => item.allClaimsFileCovered).length, completeGroundedSpanQuestions: output.filter(item => item.allClaimsGroundedSpanCovered).length }, cases: output }, null, 2));
} else {
const root = process.argv[2] ?? process.cwd();
const report = runRepositoryTaskEvaluation(root, true, true, SPRINT25_DEVELOPMENT);
const answerable = report.diagnostics.filter(item => item.gold.length);
const relevant = answerable.flatMap(item => item.gold);
const recall20 = answerable.reduce((sum, item) => sum + item.top20Recall, 0) / answerable.length;
const counts = {
  expected: relevant.length,
  notIndexed: relevant.filter(item => !item.indexed).length,
  absentTop50: relevant.filter(item => item.indexed && item.rank === null).length,
  rankedBelow5: relevant.filter(item => item.rank !== null && item.rank > 5).length,
  rankedBelow20: relevant.filter(item => item.rank !== null && item.rank > 20).length,
  groundingThreshold: relevant.filter(item => item.missedBecause === 'grounding_threshold_rejected_candidate').length,
  evidenceSelection: relevant.filter(item => item.missedBecause === 'not_in_first_five_valid_evidence').length,
  groundedRetained: relevant.filter(item => item.groundedEvidenceReturned).length
};
console.log(JSON.stringify({
  labelReview: 'self-authored, not independently reviewed',
  counts,
  raw: report.retrieval,
  grounded: report.grounded,
  macroRecall20: recall20,
  staleProbe: report.staleProbe,
  latencyMs: report.latencyMs,
  cases: report.diagnostics.map(item => ({
    query: item.query,
    expected: item.gold.map(source => ({ path: source.path, indexed: source.indexed, rank: source.rank, top5: source.rank !== null && source.rank <= 5, top20: source.rank !== null && source.rank <= 20, freshness: source.freshness, grounded: source.groundedEvidenceReturned, missedBecause: source.missedBecause }))
  }))
}, null, 2));

}
