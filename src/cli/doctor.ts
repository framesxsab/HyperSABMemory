import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import type { McpLaunch } from '../harness/mcpAccess.js';
import { TokenCompressor } from '../harness/tokenCompressor.js';
import { buildContextBlock } from '../memory/contextBlock.js';
import { readStoreRecords } from './cliUtils.js';

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
  counters?: DoctorCounters;
}

export interface DoctorCounters {
  activeRecords: number;
  forgottenRecords: number;
  checkpointCommits: number | null;
  lastRollbackHash?: string;
  estTokensSavedPct?: number;
}

export interface DoctorOptions {
  verifyTimeoutMs?: number;
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

function readConfiguredLaunch(cwd: string): McpLaunch | null {
  const candidates: Array<{ file: string; key: 'mcpServers' | 'servers' }> = [
    { file: '.cursor/mcp.json', key: 'mcpServers' },
    { file: '.mcp.json', key: 'mcpServers' },
    { file: '.vscode/mcp.json', key: 'servers' }
  ];
  for (const candidate of candidates) {
    const abs = path.join(cwd, candidate.file);
    if (!fs.existsSync(abs)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
      const bucket = payload[candidate.key];
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
      const entry = (bucket as Record<string, unknown>).hypersabmemory;
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.command !== 'string' || !Array.isArray(record.args)) continue;
      return { command: record.command, args: record.args.map(String) };
    } catch {
      continue; // corrupt configs are already reported by checkMcpConfigs
    }
  }
  return null;
}

/**
 * Spawns the configured MCP launch command over stdio, performs the
 * initialize + tools/list JSON-RPC handshake, and kills the child under a
 * timeout guard. Catches broken launch configs (the B4 bug class).
 */
export function verifyMcpLaunch(cwd: string, timeoutMs: number = 5000): Promise<DoctorCheck> {
  const launch = readConfiguredLaunch(cwd);
  if (!launch) {
    return Promise.resolve({
      name: 'mcp-launch',
      ok: true,
      detail: 'no hypersabmemory MCP entry configured yet — live handshake skipped'
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    // shell:false keeps the exact configured command/args; the win32 `cmd /c`
    // wrapper written by connect() spawns correctly as spawn('cmd', ['/c', ...]).
    const child = spawn(launch.command, launch.args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });

    const finish = (check: DoctorCheck): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeAllListeners();
      child.stdout?.removeAllListeners();
      try {
        child.kill();
      } catch {
        // already gone
      }
      resolve(check);
    };

    const timer = setTimeout(() => {
      finish({
        name: 'mcp-launch',
        ok: false,
        detail: `no tools/list response within ${timeoutMs}ms — killed ${launch.command} ${launch.args.join(' ')}`
      });
    }, timeoutMs);

    child.on('error', (err) => finish({ name: 'mcp-launch', ok: false, detail: `spawn failed: ${err.message}` }));
    child.on('exit', () => finish({
      name: 'mcp-launch',
      ok: false,
      detail: `server exited before replying to tools/list (${launch.command} ${launch.args.join(' ')})`
    }));

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      for (const line of buffer.split('\n')) {
        try {
          const message = JSON.parse(line) as { id?: unknown; result?: { tools?: unknown[] } };
          if (message.id !== 2) continue;
          const toolCount = Array.isArray(message.result?.tools) ? message.result.tools.length : 0;
          finish({
            name: 'mcp-launch',
            ok: true,
            detail: `${launch.command} ${launch.args.join(' ')} replied with ${toolCount} tool(s)`
          });
        } catch {
          // partial or non-JSON line
        }
      }
    });

    const send = (payload: object): void => {
      child.stdin?.write(`${JSON.stringify(payload)}\n`);
    };
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'hypersabmemory-doctor', version: '0' }
      }
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  });
}

async function collectCounters(cwd: string): Promise<DoctorCounters> {
  const records = readStoreRecords(cwd);
  const active = records.filter((record) => (record.status ?? 'active') === 'active');
  const counters: DoctorCounters = {
    activeRecords: active.length,
    forgottenRecords: records.filter((record) => record.status === 'forgotten').length,
    checkpointCommits: null
  };

  try {
    const { stdout } = await execFileAsync('git', ['rev-list', '--count', '--grep=^checkpoint:', 'HEAD'], { cwd });
    const count = Number.parseInt(stdout.trim(), 10);
    counters.checkpointCommits = Number.isFinite(count) ? count : 0;
  } catch {
    // not a git work tree
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-n1', '--grep=safety: pre-rollback', '--pretty=format:%h'],
      { cwd }
    );
    const hash = stdout.trim().split('\n')[0];
    if (hash) counters.lastRollbackHash = hash;
  } catch {
    // best effort only
  }

  if (active.length > 0) {
    const deliveredTokens = TokenCompressor.estimateTokens(
      buildContextBlock(active, `${active.length} item(s) recorded.`)
    );
    const naiveCorpusTokens = active.reduce(
      (sum, record) =>
        sum + TokenCompressor.estimateTokens([record.content, (record.tags ?? []).join(' ')].filter(Boolean).join(' ')),
      0
    );
    if (naiveCorpusTokens > 0) {
      counters.estTokensSavedPct =
        Math.max(0, Math.round((1 - deliveredTokens / naiveCorpusTokens) * 1000) / 10);
    }
  }

  return counters;
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
export async function runDoctor(cwd: string = process.cwd(), options: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [
    await checkGitOnPath(),
    await checkInsideWorkTree(cwd),
    checkStoreParseable(cwd),
    checkMcpConfigs(cwd),
    await verifyMcpLaunch(cwd, options.verifyTimeoutMs ?? 5000),
    await checkDashboardPort(4321)
  ];
  const counters = await collectCounters(cwd);
  const ok = checks.every((check) => check.ok);
  return { checks, ok, counters };
}
