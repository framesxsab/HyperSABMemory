import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { DashboardServer } from '../src/server/dashboardServer.js';
import { SwarmMeshEngine } from '../src/memory/swarmMesh.js';

describe('HyperSABMemory — Dashboard Server API', () => {
  let server: DashboardServer;
  let port: number;
  let dir: string;
  let baseUrl: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-dashboard-'));
    server = new DashboardServer(0, dir);
    port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serves the HTML dashboard at /', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('HyperSABMemory');
  });

  it('returns online status from /api/status', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('online');
    expect(data.workspace).toBe(dir);
    expect(typeof data.memory).toBe('string');
  });

  it('returns an array from /api/search', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=harness`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns checkpoint history from /api/history', async () => {
    const res = await fetch(`${baseUrl}/api/history`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns live context header with token count from /api/context', async () => {
    const res = await fetch(`${baseUrl}/api/context`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.header).toBe('string');
    expect(data.header).toContain('HYPERSABMEMORY');
    expect(typeof data.tokens).toBe('number');
    expect(data.tokens).toBeGreaterThan(0);
    expect(data.ceiling).toBe(1500);
  });

  it('returns graph nodes and derived edges from /api/graph', async () => {
    const res = await fetch(`${baseUrl}/api/graph`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.edges)).toBe(true);
  });

  it('rejects rollback with invalid hash', async () => {
    const res = await fetch(`${baseUrl}/api/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hypersabmemory': 'test' },
      body: JSON.stringify({ hash: 'not-a-valid-hash!!!' })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('rejects rollback with malformed body', async () => {
    const res = await fetch(`${baseUrl}/api/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hypersabmemory': 'test' },
      body: '{broken json'
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  // Raw http.request helper: undici's fetch strips forbidden headers like
  // Host, so Host-validation tests must drive the socket directly.
  function postRaw(headers: Record<string, string>): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/api/rollback', method: 'POST', headers },
        (res) => { res.resume(); resolve(res.statusCode ?? 0); }
      );
      req.on('error', reject);
      req.end(JSON.stringify({ hash: 'deadbeef' }));
    });
  }

  // HTTP/1.0 raw-socket POST: llhttp rejects Host-less HTTP/1.1 requests with
  // 400 before any handler runs, so only 1.0 reaches the app-level guard.
  function postRawHttp10(request: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => { socket.end(request); });
      let data = '';
      socket.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      socket.on('close', () => {
        const match = /^HTTP\/1\.[01] (\d{3})/.exec(data);
        if (match) resolve(Number(match[1])); else reject(new Error(`no status line: ${data}`));
      });
      socket.on('error', reject);
    });
  }

  it('rejects POST with a non-loopback Host header (DNS rebinding)', async () => {
    const status = await postRaw({
      host: 'attacker.example.com',
      'content-type': 'application/json',
      'x-hypersabmemory': 'test'
    });
    expect(status).toBe(403);
  });

  it('rejects POST with a missing Host header', async () => {
    const body = JSON.stringify({ hash: 'deadbeef' });
    const request = [
      'POST /api/rollback HTTP/1.0',
      'Content-Type: application/json',
      'x-hypersabmemory: test',
      `Content-Length: ${Buffer.byteLength(body)}`,
      '',
      body
    ].join('\r\n');
    const status = await postRawHttp10(request);
    expect(status).toBe(403);
  });

  it('rejects POST with a non-JSON content-type (CORS simple request)', async () => {
    const res = await fetch(`${baseUrl}/api/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'x-hypersabmemory': 'test' },
      body: JSON.stringify({ hash: 'deadbeef' })
    });
    expect(res.status).toBe(415);
  });

  it('rejects POST without the x-hypersabmemory header', async () => {
    const res = await fetch(`${baseUrl}/api/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: 'deadbeef' })
    });
    expect(res.status).toBe(403);
  });

  it('accepts a well-formed POST (json + custom header + loopback host)', async () => {
    const res = await fetch(`${baseUrl}/api/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hypersabmemory': 'dashboard' },
      body: JSON.stringify({ hash: 'not-a-valid-hash!!!' })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(false); // handler ran; hash is simply invalid
  });
});

describe('HyperSABMemory — Dashboard Swarm Visibility (F5)', () => {
  let server: DashboardServer;
  let port: number;
  let dir: string;
  let baseUrl: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-dashboard-swarm-'));
    // Seed live swarm state through the real engine BEFORE the server starts,
    // so the dashboard reads persisted locks + broadcasts from disk.
    const mesh = new SwarmMeshEngine(dir);
    const claim = mesh.claimFile('sess-A', path.join(dir, 'src', 'server', 'dashboardServer.ts'));
    expect(claim.ok).toBe(true);
    mesh.broadcast('sess-B', 'F5 swarm cards wired into dashboard', 'general');
    server = new DashboardServer(0, dir);
    port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns seeded locks and broadcasts from /api/swarm', async () => {
    const res = await fetch(`${baseUrl}/api/swarm`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const data = await res.json();
    expect(Array.isArray(data.fileLocks)).toBe(true);
    expect(Array.isArray(data.broadcasts)).toBe(true);
    expect(data.fileLocks).toHaveLength(1);
    // win32 canonicalization lowercases stored paths
    expect(String(data.fileLocks[0].filePath).toLowerCase()).toContain('dashboardserver.ts');
    expect(data.fileLocks[0].sessionId).toBe('sess-A');
    expect(typeof data.fileLocks[0].expiresAt).toBe('string');
    expect(data.broadcasts).toHaveLength(1);
    expect(data.broadcasts[0].message).toBe('F5 swarm cards wired into dashboard');
    expect(data.broadcasts[0].category).toBe('general');
    expect(typeof data.broadcasts[0].createdAt).toBe('string');
  });

  it('returns empty arrays from /api/swarm when no swarm state exists yet', async () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-dashboard-fresh-'));
    const freshServer = new DashboardServer(0, freshDir);
    const freshPort = await freshServer.start();
    try {
      const res = await fetch(`http://127.0.0.1:${freshPort}/api/swarm`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.fileLocks).toEqual([]);
      expect(data.broadcasts).toEqual([]);
    } finally {
      freshServer.stop();
      fs.rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('renders the swarm card section in the dashboard HTML', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="swarm-card"');
  });
});