import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import { removeTestDirs } from './testUtils.js';
import * as os from 'os';
import * as path from 'path';
import { runDoctor } from '../src/cli/doctor.js';
import { printSetupOutcome } from '../src/cli/oneShotSetup.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-doctor-'));
  dirs.push(dir);
  return dir;
}

// Minimal newline-delimited JSON-RPC peer: answers initialize (id 1) and tools/list (id 2).
const FAKE_SERVER = [
  "let buf='';process.stdin.on('data',(d)=>{",
  "buf+=d.toString();const ls=buf.split('\\n');buf=ls.pop()||'';",
  'for(const l of ls){if(!l.trim())continue;',
  'try{const m=JSON.parse(l);',
  "if(m.id===1)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'fake',version:'0'}}})+'\\n');",
  "if(m.id===2)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:2,result:{tools:[{name:'t1'}]}})+'\\n');",
  '}catch{}}});'
].join('');

function writeCursorConfig(dir: string, command: string, args: string[]): void {
  fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.cursor', 'mcp.json'),
    `${JSON.stringify({ mcpServers: { hypersabmemory: { command, args } } }, null, 2)}\n`
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  removeTestDirs(dirs);
});

describe('HyperSABMemory — doctor MCP launch verification + factual counters (F3)', () => {
  it('reports whole-repository checkpoint scope in doctor and setup output', async () => {
    const dir = tmpDir();
    const report = await runDoctor(dir);
    const scope = report.checks.find((check) => check.name === 'checkpoint-scope');
    expect(scope?.detail).toContain('stage all trackable changes at the repository root');

    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    printSetupOutcome({ success: true, createdFiles: [] }, dir);
    expect(logged.join('\n')).toContain('stage all trackable changes at the repository root');
  });

  it('verifies a working configured launch via initialize + tools/list handshake', async () => {
    const dir = tmpDir();
    writeCursorConfig(dir, process.execPath, ['-e', `if (process.cwd() !== ${JSON.stringify(dir)}) process.exit(1);${FAKE_SERVER}`]);

    const report = await runDoctor(dir);

    const check = report.checks.find((c) => c.name === 'mcp-launch');
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain('replied with 1 tool(s)');
  });

  it('times out and kills a hung server, failing gracefully', async () => {
    const dir = tmpDir();
    writeCursorConfig(dir, process.execPath, ['-e', 'setInterval(()=>{},10000)']);

    const startedAt = Date.now();
    const report = await runDoctor(dir, { verifyTimeoutMs: 700 });

    const check = report.checks.find((c) => c.name === 'mcp-launch');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('no tools/list response within 700ms');
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it('reports the real spawn error for a broken launch command', async () => {
    const dir = tmpDir();
    writeCursorConfig(dir, 'definitely-not-a-real-command-xyz', []);

    const report = await runDoctor(dir);

    const check = report.checks.find((c) => c.name === 'mcp-launch');
    expect(check?.ok).toBe(false);
    expect(check?.detail.toLowerCase()).toContain('spawn failed');
    expect(check?.detail.toLowerCase()).not.toContain('check logs');
  });

  it('prints real err.message plus partial createdFiles, never "check logs"', () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });

    printSetupOutcome({
      success: false,
      createdFiles: [path.join('AGENTS.md'), path.join('.cursor', 'rules', 'hypersabmemory.mdc')],
      error: 'EACCES: permission denied, open AGENTS.md'
    });

    const output = logged.join('\n');
    expect(output).toContain('EACCES: permission denied, open AGENTS.md');
    expect(output).toContain('AGENTS.md');
    expect(output).toContain('hypersabmemory.mdc');
    expect(output.toLowerCase()).not.toContain('check logs');
  });

  it('measures counters and stays byte-read-only on a populated store', async () => {
    const dir = tmpDir();
    const engine = new TemporalMemoryEngine(dir);
    const bulkFact = (i: number): string =>
      `Doctor fixture bulk fact ${i}: enough body text per record that the naive corpus dwarfs the capped context block.`;
    for (let i = 0; i < 40; i += 1) {
      engine.remember(i % 2 === 0 ? 'architecture' : 'decision', bulkFact(i));
    }

    const storePath = path.join(dir, '.hypersabmemory', 'memory_store.json');
    const storeBytesBefore = fs.readFileSync(storePath, 'utf-8');
    writeCursorConfig(dir, process.execPath, ['-e', FAKE_SERVER]);
    const listingBefore = fs.readdirSync(dir).sort();

    const report = await runDoctor(dir, { verifyTimeoutMs: 3000 });

    expect(fs.readFileSync(storePath, 'utf-8')).toBe(storeBytesBefore);
    expect(fs.readdirSync(dir).sort()).toEqual(listingBefore);
    expect(report.counters?.activeRecords).toBe(40);
    expect(report.counters?.forgottenRecords).toBe(0);
    expect(typeof report.counters?.checkpointCommits === 'number' || report.counters?.checkpointCommits === null).toBe(true);
    expect(report.counters?.estTokensSavedPct).toBeGreaterThan(0);
    expect(report.checks.find((c) => c.name === 'mcp-launch')?.ok).toBe(true);
  });
});
