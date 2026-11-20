import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { searchGrounded } from '../dist/memory/groundedSearch.js';
import { HybridSearchEngine } from '../dist/memory/hybridSearch.js';
import { TemporalMemoryEngine } from '../dist/memory/temporalMemory.js';
import { captureTaskSources } from '../dist/harness/taskSources.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm32-link-probe-'));
const decision = path.join(root, 'warehouse.md');
const original = 'Decision: Keep parcel storage local.\nRationale: Retain offline access.\n';
fs.writeFileSync(decision, original);
fs.writeFileSync(path.join(root, 'policy.md'), 'Decision-Source: warehouse.md\nConstraint: Parcel storage must remain on the device.\n');
const refs = captureTaskSources(root, ['warehouse.md', 'policy.md']);
const memory = new TemporalMemoryEngine(root);
memory.remember('decision', 'Parcel storage stays local', [], { artifacts: ['warehouse.md'] });
memory.remember('architecture', 'Parcel storage constraint for device', [], { artifacts: ['policy.md'] });
const engine = new HybridSearchEngine(root, memory);
const ask = () => searchGrounded(engine, root, 'What parcel storage decision was recorded, why, and which constraint follows?', refs);
assert.equal(ask().relationships?.length, 1, 'positive control');
const read = fs.readFileSync;
let reads = 0;
fs.readFileSync = (file, ...args) => {
  const result = read(file, ...args);
  if (file === decision && ++reads === 1) fs.writeFileSync(decision, original.replace('local', 'LOCAL'));
  return result;
};
syncBuiltinESMExports();
let result;
try { result = ask(); } finally { fs.readFileSync = read; syncBuiltinESMExports(); }
assert.ok(reads >= 2);
assert.ok(result.staleSources.some(source => source.path === 'warehouse.md'));
assert.equal(result.compoundAnswer, undefined);
assert.deepEqual(result.relationships, []);
assert.ok(!result.assertions.some(item => item.excerpt.startsWith('Decision-Source:')), 'the explicit link must not survive as a legacy assertion');
assert.ok(result.claims.some(claim => claim.type === 'recorded_constraint'), 'the current standalone constraint is still supported');
