import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { captureTaskSources } from '../dist/harness/taskSources.js';
import { HybridSearchEngine } from '../dist/memory/hybridSearch.js';
import { searchGrounded } from '../dist/memory/groundedSearch.js';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-source-ref-bench-'));
assert.equal(path.dirname(path.resolve(workspace)), path.resolve(os.tmpdir()));
try {
  const names = Array.from({ length: 64 }, (_, index) => `source${index}.ts`);
  for (const [index, name] of names.entries()) {
    fs.writeFileSync(path.join(workspace, name), `${'// harmless synthetic source\n'.repeat(150)}${index === 63 ? 'export class Widget {}\n' : 'export class Other {}\n'}`);
  }
  const sources = captureTaskSources(workspace, names);
  const hybrid = new HybridSearchEngine(workspace);
  const samples = [];
  for (let run = 0; run < 6; run++) {
    const started = performance.now();
    const result = searchGrounded(hybrid, workspace, 'Where is `Widget` defined?', sources);
    samples.push(performance.now() - started);
    assert.equal(result.status, 'SUPPORTED');
    assert.equal(result.assertions.length, 1);
    assert.equal(result.assertions[0].sourcePath, 'source63.ts');
  }
  samples.sort((first, second) => first - second);
  console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch }, sources: names.length, bytesPerFile: fs.statSync(path.join(workspace, names[0])).size, samples: samples.length, p50: samples[2], p95: samples[5] }, null, 2));
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
