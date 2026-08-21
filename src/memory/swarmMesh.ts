/**
 * HyperSABMemory — Swarm Shared Memory Mesh
 * Shared cross-agent state (broadcasts + file locks) for parallel subagents,
 * persisted to a local JSON file. Zero dependencies, single-process MCP.
 */

import * as fs from 'fs';
import * as path from 'path';

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

  private saveState(): void {
    try {
      fs.writeFileSync(this.swarmStatePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('[HyperSABMemory :: SwarmMesh] Failed to write swarm state:', err);
    }
  }

  private pruneExpired(): void {
    const cutoff = this.now().getTime();
    this.state.broadcasts = this.state.broadcasts.filter((b) => new Date(b.expiresAt).getTime() > cutoff);
    this.state.fileLocks = this.state.fileLocks.filter((l) => new Date(l.expiresAt).getTime() > cutoff);
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
    const id = sessionId?.trim() || randomId('swarm');
    this.registerSession(id);
    this.saveState();
    return id;
  }

  public broadcast(sessionId: string | undefined, message: string, category?: string): SwarmBroadcast {
    const id = this.getOrCreateSessionId(sessionId);
    const trimmed = message.trim();
    const nowMs = this.now().getTime();
    const expiresAt = this.toIso(nowMs + this.broadcastTtlMs);

    const existing = this.state.broadcasts.find(
      (b) => b.message === trimmed && (b.category ?? undefined) === (category?.trim() || undefined) && new Date(b.expiresAt).getTime() > nowMs
    );
    if (existing) return existing;

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
  }

  public claimFile(sessionId: string | undefined, filePath: string, ttlMs?: number): ClaimResult {
    const id = this.getOrCreateSessionId(sessionId);
    const nowMs = this.now().getTime();
    const expiresAt = this.toIso(nowMs + (ttlMs ?? this.lockTtlMs));
    const normalized = path.normalize(filePath);

    const existing = this.state.fileLocks.find((l) => l.filePath === normalized);
    if (existing) {
      if (existing.sessionId === id) {
        existing.acquiredAt = new Date(nowMs).toISOString();
        existing.expiresAt = expiresAt;
        this.saveState();
        return { ok: true, lock: existing };
      }
      if (new Date(existing.expiresAt).getTime() > nowMs) {
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
  }

  public releaseFile(sessionId: string | undefined, filePath: string): ClaimResult {
    const id = this.getOrCreateSessionId(sessionId);
    const normalized = path.normalize(filePath);
    const existing = this.state.fileLocks.find((l) => l.filePath === normalized);
    if (!existing) return { ok: true, reason: 'not-locked' };
    if (existing.sessionId !== id) {
      return { ok: false, heldBy: existing.sessionId, reason: 'not-owner' };
    }
    this.state.fileLocks = this.state.fileLocks.filter((l) => l.filePath !== normalized);
    this.saveState();
    return { ok: true };
  }

  public sync(sessionId?: string): { sessionId: string; broadcasts: SwarmBroadcast[]; fileLocks: SwarmFileLock[] } {
    const id = this.getOrCreateSessionId(sessionId);
    this.pruneExpired();
    this.saveState();
    return {
      sessionId: id,
      broadcasts: [...this.state.broadcasts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      fileLocks: [...this.state.fileLocks]
    };
  }
}