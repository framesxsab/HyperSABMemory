import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DashboardServer } from '../src/server/dashboardServer.js';

describe('HyperMemory — Dashboard Server API', () => {
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
    expect(await res.text()).toContain('HyperMemory');
  });

  it('returns online status from /api/status', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('online');
    expect(data.workspace).toBe(dir);
    expect(typeof data.supermemory).toBe('string');
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
    expect(data.header).toContain('HYPERMEMORY');
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: 'not-a-valid-hash!!!' })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('rejects rollback with malformed body', async () => {
    const res = await fetch(`${baseUrl}/api/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken json'
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});