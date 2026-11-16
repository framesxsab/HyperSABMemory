/**
 * HyperSABMemory — Swarm Shared Memory Mesh
 * Shared cross-agent state (broadcasts + file locks) for parallel subagents,
 * persisted to a local JSON file. Zero dependencies, single-process MCP.
 */

import * as fs from 'fs';
import * as path from 'path';
import { withFileLock, writeAtomicText } from './fileLock.js';

export interface SwarmBroadcast {
  id: string;
  sessionId: string;
  message: string;
  category?: string;
  createdAt: string;
  expiresAt: string;
}

export interface SwarmFileLock {
  filePath: string;
  sessionId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface SwarmState {
  broadcasts: SwarmBroadcast[];
  fileLocks: SwarmFileLock[];
  sessions: string[];
}

export interface SwarmMeshOptions {
  broadcastTtlMs?: number;
  lockTtlMs?: number;
  now?: () => Date;
}

export interface ClaimResult {
  ok: boolean;
  lock?: SwarmFileLock;
  heldBy?: string;
  reason?: string;
}

const DEFAULT_BROADCAST_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export class SwarmMeshEngine {
  private swarmStatePath: string;
  private state: SwarmState;
  private broadcastTtlMs: number;
  private lockTtlMs: number;
  private now: () => Date;

  constructor(workspaceDir: string, options: SwarmMeshOptions = {}) {
    this.swarmStatePath = path.join(workspaceDir, '.hypersabmemory', 'swarm_state.json');
    this.broadcastTtlMs = options.broadcastTtlMs ?? DEFAULT_BROADCAST_TTL_MS;
    this.lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.now = options.now ?? (() => new Date());
    fs.mkdirSync(path.dirname(this.swarmStatePath), { recursive: true });
    this.state = this.loadState();
  }

  private loadState(): SwarmState {
    try {
      if (fs.existsSync(this.swarmStatePath)) {
        const raw = fs.readFileSync(this.swarmStatePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<SwarmState>;
        return {
          broadcasts: Array.isArray(parsed.broadcasts) ? parsed.broadcasts : [],
          fileLocks: Array.isArray(parsed.fileLocks) ? parsed.fileLocks : [],
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
        };
      }
    } catch {
      // Fallback on clean state on parse error
    }
    return { broadcasts: [], fileLocks: [], sessions: [] };
  }

  private get lockPath(): string {
    return `${this.swarmStatePath}.lock`;
  }

  private canonicalKey(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  private mutate<T>(fn: () => T): T {
    return withFileLock(this.lockPath, () => {
      this.state = this.loadState();
      return fn();
    });
  }

  private saveState(): void {
    try {
      const payload = JSON.stringify(this.state, null, 2);
      writeAtomicText(this.swarmStatePath, payload);
    } catch (err) {
      console.error('[HyperSABMemory :: SwarmMesh] Failed to write swarm state:', err);
    }
  }

  private pruneExpired(): void {
    const cutoff = this.now().getTime();
    this.state.broadcasts = this.state.broadcasts.filter((b) => new Date(b.expiresAt).getTime() > cutoff);
    this.state.fileLocks = this.state.fileLocks.filter((l) => new Date(l.expiresAt).getTime() > cutoff);
    const liveSessions = new Set<string>();
    for (const b of this.state.broadcasts) liveSessions.add(b.sessionId);
    for (const l of this.state.fileLocks) liveSessions.add(l.sessionId);
    this.state.sessions = this.state.sessions.filter((s) => liveSessions.has(s));
  }

  private registerSession(sessionId: string): void {
    if (!this.state.sessions.includes(sessionId)) {
      this.state.sessions.push(sessionId);
    }
  }

  private toIso(ms: number): string {
    return new Date(ms).toISOString();
  }

  public getOrCreateSessionId(sessionId?: string): string {
    return sessionId?.trim() || randomId('swarm');
  }

  public broadcast(sessionId: string | undefined, message: string, category?: string): SwarmBroadcast {
    return this.mutate(() => {
      this.pruneExpired();
      const id = this.getOrCreateSessionId(sessionId);
      this.registerSession(id);
      const trimmed = message.trim();
      const nowMs = this.now().getTime();
      const expiresAt = this.toIso(nowMs + this.broadcastTtlMs);

      const existing = this.state.broadcasts.find(
        (b) => b.message === trimmed && (b.category ?? undefined) === (category?.trim() || undefined) && new Date(b.expiresAt).getTime() > nowMs
      );
      if (existing) {
        this.saveState();
        return existing;
      }

      const record: SwarmBroadcast = {
        id: randomId('brc'),
        sessionId: id,
        message: trimmed,
        category: category?.trim() || undefined,
        createdAt: new Date(nowMs).toISOString(),
        expiresAt
      };
      this.state.broadcasts.push(record);
      this.saveState();
      return record;
    });
  }

  public claimFile(sessionId: string | undefined, filePath: string, ttlMs?: number): ClaimResult {
    return this.mutate(() => {
      this.pruneExpired();
      const id = this.getOrCreateSessionId(sessionId);
      this.registerSession(id);
      const nowMs = this.now().getTime();
      const expiresAt = this.toIso(nowMs + (ttlMs ?? this.lockTtlMs));
      const normalized = this.canonicalKey(filePath);

      const existing = this.state.fileLocks.find((l) => l.filePath === normalized);
      if (existing) {
        if (existing.sessionId === id) {
          existing.acquiredAt = new Date(nowMs).toISOString();
          existing.expiresAt = expiresAt;
          this.saveState();
          return { ok: true, lock: existing };
        }
        if (new Date(existing.expiresAt).getTime() > nowMs) {
          this.saveState();
          return { ok: false, lock: existing, heldBy: existing.sessionId, reason: 'locked' };
        }
        this.state.fileLocks = this.state.fileLocks.filter((l) => l.filePath !== normalized);
      }

      const lock: SwarmFileLock = {
        filePath: normalized,
        sessionId: id,
        acquiredAt: new Date(nowMs).toISOString(),
        expiresAt
      };
      this.state.fileLocks.push(lock);
      this.saveState();
      return { ok: true, lock };
    });
  }

  public releaseFile(sessionId: string | undefined, filePath: string): ClaimResult {
    return this.mutate(() => {
      this.pruneExpired();
      const id = this.getOrCreateSessionId(sessionId);
      this.registerSession(id);
      const normalized = this.canonicalKey(filePath);
      const existing = this.state.fileLocks.find((l) => l.filePath === normalized);
      if (!existing) {
        this.saveState();
        return { ok: true, reason: 'not-locked' };
      }
      if (existing.sessionId !== id) {
        this.saveState();
        return { ok: false, heldBy: existing.sessionId, reason: 'not-owner' };
      }
      this.state.fileLocks = this.state.fileLocks.filter((l) => l.filePath !== normalized);
      this.saveState();
      return { ok: true };
    });
  }

  public sync(sessionId?: string): { sessionId: string; broadcasts: SwarmBroadcast[]; fileLocks: SwarmFileLock[] } {
    // Read-only: atomic tmp+rename writes mean a plain read never sees torn
    // state, so no lock is taken and nothing is persisted. Session ids are
    // registered lazily on the next true mutation instead.
    const id = sessionId?.trim() || randomId('swarm');
    const state = this.loadState();
    const cutoff = this.now().getTime();
    return {
      sessionId: id,
      broadcasts: state.broadcasts
        .filter((b) => new Date(b.expiresAt).getTime() > cutoff)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      fileLocks: state.fileLocks.filter((l) => new Date(l.expiresAt).getTime() > cutoff)
    };
  }
}
