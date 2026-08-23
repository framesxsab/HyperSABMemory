import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SwarmMeshEngine } from '../src/memory/swarmMesh.js';

describe('HyperSABMemory — Swarm Shared Memory Mesh', () => {
  function makeDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'hm-swarm-'));
  }

  function makeEngine(dir: string, startMs: number): { engine: SwarmMeshEngine; advance: (ms: number) => void } {
    let current = startMs;
    const engine = new SwarmMeshEngine(dir, {
      lockTtlMs: 10_000,
      broadcastTtlMs: 60_000,
      now: () => new Date(current)
    });
    return { engine, advance: (ms) => { current += ms; } };
  }

  it('assigns a stable session id per caller', () => {
    const dir = makeDir();
    try {
      const { engine } = makeEngine(dir, 1_000);
      const a = engine.getOrCreateSessionId('agent-a');
      const a2 = engine.getOrCreateSessionId('agent-a');
      const b = engine.getOrCreateSessionId();
      expect(a).toBe('agent-a');
      expect(a2).toBe('agent-a');
      expect(b).not.toBe('agent-a');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('locks a file exclusively and denies other sessions', () => {
    const dir = makeDir();
    try {
      const { engine } = makeEngine(dir, 1_000);
      const first = engine.claimFile('agent-a', 'src/foo.ts');
      expect(first.ok).toBe(true);
      const denied = engine.claimFile('agent-b', 'src/foo.ts');
      expect(denied.ok).toBe(false);
      expect(denied.heldBy).toBe('agent-a');
      expect(denied.reason).toBe('locked');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets the owner renew and re-locks after expiry (stale takeover)', () => {
    const dir = makeDir();
    try {
      const { engine, advance } = makeEngine(dir, 1_000);
      const first = engine.claimFile('agent-a', 'src/foo.ts');
      expect(first.ok).toBe(true);
      const renewed = engine.claimFile('agent-a', 'src/foo.ts');
      expect(renewed.ok).toBe(true);

      advance(11_000);
      const takeover = engine.claimFile('agent-b', 'src/foo.ts');
      expect(takeover.ok).toBe(true);
      expect(takeover.lock?.sessionId).toBe('agent-b');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('only the owner can release a lock', () => {
    const dir = makeDir();
    try {
      const { engine } = makeEngine(dir, 1_000);
      engine.claimFile('agent-a', 'src/foo.ts');
      const denied = engine.releaseFile('agent-b', 'src/foo.ts');
      expect(denied.ok).toBe(false);
      expect(denied.reason).toBe('not-owner');
      const released = engine.releaseFile('agent-a', 'src/foo.ts');
      expect(released.ok).toBe(true);
      expect(engine.sync().fileLocks).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dedupes identical broadcasts within the TTL window', () => {
    const dir = makeDir();
    try {
      const { engine } = makeEngine(dir, 1_000);
      const first = engine.broadcast('agent-a', 'Found the auth middleware');
      const second = engine.broadcast('agent-b', 'Found the auth middleware');
      expect(second.id).toBe(first.id);
      const distinct = engine.broadcast('agent-a', 'A different finding');
      expect(distinct.id).not.toBe(first.id);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prunes expired broadcasts and locks from sync()', () => {
    const dir = makeDir();
    try {
      const { engine, advance } = makeEngine(dir, 1_000);
      engine.broadcast('agent-a', 'transient finding');
      engine.claimFile('agent-a', 'src/bar.ts');
      advance(120_000);
      const snapshot = engine.sync();
      expect(snapshot.broadcasts).toHaveLength(0);
      expect(snapshot.fileLocks).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sync() is read-only: no bytes written and no session persisted', () => {
    const dir = makeDir();
    try {
      const writer = makeEngine(dir, 1_000).engine;
      writer.broadcast('agent-a', 'seed broadcast');

      const statePath = path.join(dir, '.hypersabmemory', 'swarm_state.json');
      const before = fs.readFileSync(statePath, 'utf-8');

      const reader = new SwarmMeshEngine(dir, { now: () => new Date(2_000) });
      reader.sync();

      const after = fs.readFileSync(statePath, 'utf-8');
      expect(after).toBe(before);
      const parsed = JSON.parse(after) as { sessions: string[] };
      expect(parsed.sessions).toEqual(['agent-a']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prunes dead sessions from persisted state during a mutation', () => {
    const dir = makeDir();
    try {
      const { engine, advance } = makeEngine(dir, 1_000);
      engine.broadcast('agent-a', 'short-lived finding');
      advance(120_000);
      engine.broadcast('agent-b', 'replacement finding');

      const statePath = path.join(dir, '.hypersabmemory', 'swarm_state.json');
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as { sessions: string[] };
      expect(parsed.sessions).toEqual(['agent-b']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists state across engine instances on the same workspace', () => {
    const dir = makeDir();
    try {
      const { engine } = makeEngine(dir, 1_000);
      engine.broadcast('agent-a', 'persisted across restart');
      const fresh = new SwarmMeshEngine(dir, { now: () => new Date(5_000) });
      const snapshot = fresh.sync();
      expect(snapshot.broadcasts.some((b) => b.message === 'persisted across restart')).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});