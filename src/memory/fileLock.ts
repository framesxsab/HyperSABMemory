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

// Bounded rename backoff: 5 total attempts with 300ms cumulative sleep (< 2000ms lock budget, PID stays live).
export const ATOMIC_RENAME_RETRY_DELAYS_MS: readonly number[] = [20, 40, 80, 160];
export const ATOMIC_RENAME_MAX_ATTEMPTS = ATOMIC_RENAME_RETRY_DELAYS_MS.length + 1;

export interface WriteAtomicOptions {
  sleep?: (ms: number) => void;
}

// Leave the temporary file after a failed rename for store recovery.
export function writeAtomicText(filePath: string, payload: string, options?: WriteAtomicOptions): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, payload, 'utf-8');
  const sleep = options?.sleep ?? sleepSync;
  for (let attempt = 0; attempt < ATOMIC_RENAME_MAX_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const isRetryable = code === 'EPERM' || code === 'EBUSY';
      if (!isRetryable || attempt === ATOMIC_RENAME_MAX_ATTEMPTS - 1) throw err;
      sleep(ATOMIC_RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

export function sleepSync(ms: number): void {
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
  try {
    process.kill(sentinel.pid, 0);
    return false; // holder alive
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

export function acquireFileLock(lockPath: string, budgetMs: number = BUDGET_MS, recoverDead = true): void {
  const deadline = Date.now() + budgetMs;
  let backoffMs = START_BACKOFF_MS;

  while (true) {
    if (tryAcquire(lockPath)) return;
    if (Date.now() >= deadline) throw new LockAcquireError(lockPath, budgetMs);
    if (recoverDead && isHolderDead(lockPath)) {
      releaseFileLock(lockPath);
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

/** Wait without blocking the event loop while an asynchronous operation owns the lock. */
export async function acquireFileLockAsync(lockPath: string, budgetMs: number = BUDGET_MS): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!tryAcquire(lockPath)) {
    if (Date.now() >= deadline) throw new LockAcquireError(lockPath, budgetMs);
    if (isHolderDead(lockPath)) releaseFileLock(lockPath);
    else await new Promise<void>((resolve) => setTimeout(resolve, MAX_BACKOFF_MS));
  }
}

export function withFileLock<T>(lockPath: string, fn: () => T, recoverDead = true): T {
  acquireFileLock(lockPath, BUDGET_MS, recoverDead);
  try {
    return fn();
  } finally {
    releaseFileLock(lockPath);
  }
}
