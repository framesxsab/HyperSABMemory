import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.resolve(root, 'dist');
assert.equal(path.dirname(output), root, 'build cleanup stays inside the repository');
rmSync(output, { recursive: true, force: true });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc')], {
  cwd: root,
  stdio: 'inherit'
});
