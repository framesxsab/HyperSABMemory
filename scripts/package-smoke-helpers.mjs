import assert from 'node:assert/strict';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/** Resolve a real, existing file path on disk (throws AssertionError when missing or not a file). */
export function canonicalExistingFile(filePath, label) {
  assert.equal(typeof filePath, 'string', `${label}: path must be a string`);
  assert.ok(filePath.length > 0, `${label}: path must be non-empty`);

  const resolved = path.resolve(filePath);
  let canonical;
  try {
    canonical = process.platform === 'win32'
      ? realpathSync.native(resolved)
      : realpathSync(resolved);
  } catch (err) {
    assert.fail(`${label}: expected existing file at ${resolved} (${err instanceof Error ? err.message : String(err)})`);
  }

  let stats;
  try {
    stats = statSync(canonical);
  } catch (err) {
    assert.fail(`${label}: failed to stat ${canonical} (${err instanceof Error ? err.message : String(err)})`);
  }
  assert.ok(stats.isFile(), `${label}: expected a regular file at ${canonical}`);
  return canonical;
}

/** Verify that two CLI entry paths refer to the exact same installed file on disk. */
export function assertSameInstalledCliEntry(
  actualPath,
  expectedPath,
  message = 'setup points directly to the installed dist/cli/index.js entry'
) {
  const actualCanonical = canonicalExistingFile(actualPath, `${message} (configured entry)`);
  const expectedCanonical = canonicalExistingFile(expectedPath, `${message} (installed entry)`);

  if (process.platform === 'win32') {
    assert.equal(actualCanonical.toLowerCase(), expectedCanonical.toLowerCase(), message);
  } else {
    assert.equal(actualCanonical, expectedCanonical, message);
  }
  return actualCanonical;
}
