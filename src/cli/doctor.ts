import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

async function checkGitOnPath(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('git', ['--version']);
    return { name: 'git', ok: true, detail: stdout.trim() };
  } catch {
    return { name: 'git', ok: false, detail: 'git not found on PATH' };
  }
}

async function checkInsideWorkTree(cwd: string): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
    return { name: 'worktree', ok: stdout.trim() === 'true', detail: stdout.trim() === 'true' ? cwd : 'not a git work tree' };
  } catch {
    return { name: 'worktree', ok: false, detail: 'not a git repository' };
  }
}

function checkStoreParseable(cwd: string): DoctorCheck {
  const storePath = path.join(cwd, '.hypersabmemory', 'memory_store.json');
  if (!fs.existsSync(storePath)) {
    return { name: 'store', ok: true, detail: 'no store yet (created on first remember)' };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return { name: 'store', ok: true, detail: `${parsed.length} record(s), valid JSON` };
  } catch (err) {
    return { name: 'store', ok: false, detail: `corrupt store: ${(err as Error).message}` };
  }
}

function checkMcpConfigs(cwd: string): DoctorCheck {
  const candidates = ['.cursor/mcp.json', '.mcp.json', '.vscode/mcp.json'];
  const present: string[] = [];
  const corrupt: string[] = [];
  for (const candidate of candidates) {
    const full = path.join(cwd, candidate);
    if (!fs.existsSync(full)) continue;
    try {
      JSON.parse(fs.readFileSync(full, 'utf-8'));
      present.push(candidate);
    } catch {
      corrupt.push(candidate);
    }
  }
  if (corrupt.length > 0) {
    return { name: 'mcp-configs', ok: false, detail: `unparseable: ${corrupt.join(', ')}` };
  }
  return {
    name: 'mcp-configs',
    ok: true,
    detail: present.length > 0 ? present.join(', ') : 'none yet — run `npx hypersabmemory connect`'
  };
}

function checkDashboardPort(port: number): Promise<DoctorCheck> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve({ name: `port ${port}`, ok: true, detail: 'in use (dashboard may be running)' }));
    probe.once('listening', () => probe.close(() => resolve({ name: `port ${port}`, ok: true, detail: 'free' })));
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * Read-only health self-check. Never mutates workspace state; hard failures
 * are missing git and an unparseable store.
 */
export async function runDoctor(cwd: string = process.cwd()): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [
    await checkGitOnPath(),
    await checkInsideWorkTree(cwd),
    checkStoreParseable(cwd),
    checkMcpConfigs(cwd),
    await checkDashboardPort(4321)
  ];
  const ok = checks.every((check) => check.ok);
  return { checks, ok };
}
