import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileWatcherHook } from '../dist/hooks/fileWatcher.js';
import { TemporalMemoryEngine } from '../dist/memory/temporalMemory.js';
import { FILE_EVENT_FACT_PATTERN } from '../dist/memory/contextBlock.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm35-watcher-'));
try {
  const rel = 'src/services/orders/reconciliation/pipeline.ts';
  const nativeRel = path.join(...rel.split('/'));
  const relSecond = 'src/services/orders/reconciliation/validator.ts';
  const nativeRelSecond = path.join(...relSecond.split('/'));
  const engine = new TemporalMemoryEngine(root);
  const userFactNative = engine.remember(
    'architecture',
    'File change: ' + nativeRel + ' keeps manual tax guards',
    [],
    { artifacts: [rel] }
  );
  const userFactPosix = engine.remember(
    'architecture',
    'File change: ' + rel + ' keeps manual currency guards',
    [],
    { artifacts: [rel] }
  );

  const hook = new FileWatcherHook({ workspaceDir: root });
  hook.onFileEvent('change', path.join(root, ...rel.split('/')));

  const activeAfterChange = new TemporalMemoryEngine(root).getActive();
  assert.ok(
    activeAfterChange.some(record => record.id === userFactNative.id && record.status === 'active') &&
    activeAfterChange.some(record => record.id === userFactPosix.id && record.status === 'active'),
    'auto file-event observations must not supersede user-confirmed memories'
  );
  const autoChange = activeAfterChange.find(record => record.id !== userFactNative.id && record.id !== userFactPosix.id && record.source === 'auto');
  assert.ok(autoChange, 'watcher event must persist source: auto provenance');
  assert.ok(FILE_EVENT_FACT_PATTERN.test(autoChange.content), 'watcher event must preserve FILE_EVENT_FACT_PATTERN');
  assert.ok(
    autoChange.artifacts?.map(item => item.replace(/\\/g, '/')).includes(rel),
    'watcher event must attach normalized workspace-relative artifact path'
  );

  hook.onFileEvent('add', path.join(root, ...relSecond.split('/')));
  const autoAdd = new TemporalMemoryEngine(root).getActive().find(
    record => record.source === 'auto' && record.artifacts?.map(item => item.replace(/\\/g, '/')).includes(relSecond)
  );
  assert.ok(autoAdd, 'add event must also carry source: auto and normalized artifact');

  const userSecond = new TemporalMemoryEngine(root).remember(
    'architecture',
    'File change: ' + nativeRelSecond + ' verified after schema check',
    [],
    { artifacts: [relSecond] }
  );
  hook.onFileEvent('unlink', path.join(root, ...relSecond.split('/')));
  const activeAfterUnlink = new TemporalMemoryEngine(root).getActive();
  assert.ok(
    activeAfterUnlink.some(record => record.id === userSecond.id && record.status === 'active'),
    'unlink file-event observation must not supersede user-confirmed memory'
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
