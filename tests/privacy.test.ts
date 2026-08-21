import { describe, it, expect, afterAll } from 'vitest';
import { resolveActiveFilePath } from '../src/mcp/server.js';
import { DashboardServer } from '../src/server/dashboardServer.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('HyperMemory — Privacy Hardening (P9)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-privacy-'));
  fs.writeFileSync(path.join(dir, 'real.ts'), 'export const ok = true;', 'utf-8');

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects traversal outside the workspace', () => {
    expect(resolveActiveFilePath(dir, '../../etc/passwd')).toBeUndefined();
    expect(resolveActiveFilePath(dir, '..\\..\\windows\\win.ini')).toBeUndefined();
  });

  it('resolves absolute paths that live inside the workspace', () => {
    expect(resolveActiveFilePath(dir, path.join(dir, 'real.ts'))).toBe(
      path.resolve(dir, 'real.ts')
    );
  });

  it('resolves normal relative paths', () => {
    expect(resolveActiveFilePath(dir, 'real.ts')).toBe(path.resolve(dir, 'real.ts'));
  });

  it('serves no CORS wildcard on the localhost dashboard', async () => {
    const server = new DashboardServer(0, dir);
    const port = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      server.stop();
    }
  });
});
