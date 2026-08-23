/**
 * HyperSABMemory — Synchronous cross-process file lock (CAS mutex).
 * Zero-dependency, no open handles while waiting (Windows unlink requirement).
 */

import * as fs from 'fs';

export class LockAcquireError extends Error {
  public readonly lockPath: string;

  constructor(lockPath: string, budgetMs: number) {
    super(`Could not acquire lock "${lockPath}" within ${budgetMs}ms budget`);
    this.name = 'LockAcquireError';
    this.lockPath = lockPath;
  }
}

interface LockSentinel {
  pid: number;
  acquiredAt: number;
}

const START_BACKOFF_MS = 5;
const MAX_BACKOFF_MS = 50;
const BUDGET_MS = 2000;
const UNPARSEABLE_GRACE_MS = 5000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readSentinel(lockPath: string): LockSentinel | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    if (
      typeof parsed === 'object' && parsed !== null &&
      typeof (parsed as LockSentinel).pid === 'number' &&
      typeof (parsed as LockSentinel).acquiredAt === 'number'
    ) {
      return parsed as LockSentinel;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function tryAcquire(lockPath: string): boolean {
  const sentinel: LockSentinel = { pid: process.pid, acquiredAt: Date.now() };
  try {
    fs.writeFileSync(lockPath, JSON.stringify(sentinel), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function isHolderDead(lockPath: string): boolean {
  const sentinel = readSentinel(lockPath);
  if (sentinel === undefined) {
    // Unparseable/garbage sentinel: only evict once it is clearly abandoned,
    // so we never unlink under a live writer mid-write.
    try {
      return Date.now() - fs.statSync(lockPath).mtimeMs > UNPARSEABLE_GRACE_MS;
    } catch {
      return false; // vanished; next spin just acquires
    }
  }
  if (sentinel.pid === process.pid) return true; // engines are recreated constantly in tests
  try {
    process.kill(sentinel.pid, 0);
    return false; // holder alive
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

function evict(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // already gone or momentarily held; the acquire loop is deadline-bounded
  }
}

export function acquireFileLock(lockPath: string, budgetMs: number = BUDGET_MS): void {
  const deadline = Date.now() + budgetMs;
  let backoffMs = START_BACKOFF_MS;

  while (true) {
    if (tryAcquire(lockPath)) return;
    if (Date.now() >= deadline) throw new LockAcquireError(lockPath, budgetMs);
    if (isHolderDead(lockPath)) {
      evict(lockPath);
      continue; // immediate re-acquire attempt after eviction
    }
    sleepSync(Math.min(backoffMs, MAX_BACKOFF_MS));
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }
}

export function releaseFileLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // best-effort: ENOENT means another holder's release/eviction won the race
  }
}

export function withFileLock<T>(lockPath: string, fn: () => T): T {
  acquireFileLock(lockPath);
  try {
    return fn();
  } finally {
    releaseFileLock(lockPath);
  }
}
