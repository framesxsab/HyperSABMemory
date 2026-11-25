import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  classifyQueryEvidence,
  HyperSABMemoryMcpServer,
  mapGraphHitsToRecords,
  parseRememberArgs,
  selectQueryRecords,
  QuerySource
} from '../src/mcp/server.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';
import { HybridSearchEngine, HybridSearchResult } from '../src/memory/hybridSearch.js';
import * as fs from 'fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { removeTestDirs, matchesTargetFile } from './testUtils.js';
import * as os from 'os';
import * as path from 'path';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mcpq-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  removeTestDirs(dirs);
});

function seedMemoryFixture(dir: string): { memory: TemporalMemoryEngine; hybrid: HybridSearchEngine } {
  const memory = new TemporalMemoryEngine(dir);
  memory.remember('decision', 'Use BM25 plus RRF fusion for hybrid search');
  memory.remember('bug', 'Watcher debounce was noisy before the fix');
  const hybrid = new HybridSearchEngine(dir, memory);
  return { memory, hybrid };
}

describe('HyperSABMemory — Hybrid MCP Query (P7)', () => {
  it('keeps source "memory" byte-identical to the pre-change searchRecords output', () => {
    const dir = tmpDir();
    const { hybrid } = seedMemoryFixture(dir);

    const viaHelper = selectQueryRecords(hybrid, 'hybrid search', 10, 'memory');
    const direct = hybrid.searchRecords('hybrid search', 10);

    expect(JSON.stringify(viaHelper, null, 2)).toBe(JSON.stringify(direct, null, 2));
  });

  it('defaults to "all" and stays byte-identical to "memory" when the graph is empty', () => {
    const dir = tmpDir();
    const { hybrid } = seedMemoryFixture(dir);

    const all = selectQueryRecords(hybrid, 'watcher debounce', 10, 'all');
    const memory = selectQueryRecords(hybrid, 'watcher debounce', 10, 'memory');

    expect(JSON.stringify(all)).toBe(JSON.stringify(memory));
  });

  it('maps graph hits onto synthetic MemoryRecord shape with graph_ ids', () => {
    const hits: HybridSearchResult[] = [
      {
        score: 1,
        source: 'graph',
        title: '[CLASS] SqliteStore',
        snippet: 'AST Node: SqliteStore (class) | Dependencies: fs',
        category: 'class'
      },
      { score: 1, source: 'memory', title: '[DECISION] m1', snippet: 'memory leg hit' }
    ];

    const records = mapGraphHitsToRecords(hits);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('graph_SqliteStore');
    expect(records[0].category).toBe('symbol');
    expect(records[0].content).toContain('AST Node: SqliteStore');
    expect(typeof records[0].timestamp).toBe('string');
  });

  it('caps the combined array at limit with memory first, graph filling the rest', () => {
    const dir = tmpDir();
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'alpha symbol naming convention');
    const graphJson = path.join(dir, 'graph.json');
    fs.writeFileSync(graphJson, JSON.stringify({
      nodes: [{ id: 'n1', type: 'function', name: 'alphaSymbolHelper' }]
    }));

    const hybrid = new HybridSearchEngine(dir, memory);

    const combined = selectQueryRecords(hybrid, 'symbol', 2, 'all');
    expect(combined.length).toBeLessThanOrEqual(2);
    expect((combined[0].id ?? '').startsWith('graph_')).toBe(false);

    const graphOnly = selectQueryRecords(hybrid, 'symbol', 5, 'graph');
    expect(graphOnly.length).toBeGreaterThan(0);
    for (const record of graphOnly) {
      expect(record.id.startsWith('graph_')).toBe(true);
    }
  });

  it('returns bounded source-backed evidence and abstains on unsupported claims through MCP', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'prefs.json'), '{\n  "port": 4317\n}\n');
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'The project stores port configuration locally.', [], { artifacts: ['prefs.json'] });
    const server = new HyperSABMemoryMcpServer(dir);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const client = new Client({ name: 'evidence-query-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = await client.listTools();
      expect(tools.tools.some(tool => tool.name === 'hypersabmemory_query_evidence')).toBe(true);
      const result = await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: 'What port is configured for the local service?' } });
      const packet = JSON.parse(result.content[0].text);
      console.log('PACKET', JSON.stringify(packet));
      expect(packet.question).toBe('What port is configured for the local service?');
      expect(packet.records[0]).toMatchObject({ attribution: 'recorded_memory', artifacts: ['prefs.json'] });
      expect(packet.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ source: expect.objectContaining({ path: 'prefs.json', freshness: 'current', sha256: expect.any(String) }) })]));
      expect(packet.answerVerified).toBe(true);
      expect(packet.assertions).toEqual([expect.objectContaining({ claim: expect.stringContaining('Configuration port in prefs.json is 4317.'), sourcePath: 'prefs.json' })]);
      expect(packet.limitations.join(' ')).toContain('does not prove');
      fs.writeFileSync(path.join(dir, 'secondary.json'), '{\n  "port": 4318\n}\n');
      memory.remember('decision', 'The project port is 4318.', [], { artifacts: ['secondary.json'] });
      const conflictResult = await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: 'What port is configured for the local service?' } });
      const conflict = JSON.parse(conflictResult.content[0].text);
      expect(conflict.answerVerified).toBe(false);
      expect(conflict.assertions).toEqual([]);
      expect(conflict.status).toBe('evidence_found');
      expect(conflict.limitations.join(' ')).toContain('deterministic verifier');
      const missing = await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: 'Which carrier handles these parcels?' } });
      const abstention = JSON.parse(missing.content[0].text);
      expect(abstention.answerVerified).toBe(false);
      expect(abstention.assertions).toEqual([]);
    } finally { await client.close(); }
  });

  it('returns source-backed decision claims without asserting implementation compliance', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'arbitrary-notes.md'), 'Decision: Validate names locally.\nRationale: Avoid a hosted dependency.\n');
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'Validate names locally.', [], { artifacts: ['arbitrary-notes.md'] });
    const server = new HyperSABMemoryMcpServer(dir);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const client = new Client({ name: 'evidence-decision-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const response = await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: 'What was decided about name validation and why?' } });
      const packet = JSON.parse(response.content[0].text);
      expect(packet.records[0]).toMatchObject({ attribution: 'recorded_memory', statement: 'Validate names locally.' });
      expect(packet.evidence.some((item: any) => item.source.path === 'arbitrary-notes.md' && item.source.freshness === 'current')).toBe(true);
      expect(packet.answerVerified).toBe(true);
      expect(packet.claims).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'recorded_decision', claim: 'The source records the decision: Validate names locally.' }),
        expect.objectContaining({ type: 'recorded_rationale', claim: 'The source records the rationale: Avoid a hosted dependency.' })
      ]));
      expect(packet.limitations.join(' ')).toContain('implementation compliance');
      const compliance = await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: 'Is name validation correctly implemented according to that decision?' } });
      const unsupported = JSON.parse(compliance.content[0].text);
      expect(unsupported.answerVerified).toBe(false);
      expect(unsupported.assertions).toEqual([]);
      expect(unsupported.claims).toEqual([]);
    } finally { await client.close(); }
  });

  it('returns bounded multi-source claims only when a current explicit source link is unique', async () => {
    const dir = tmpDir();
    const decisionPath = 'design/storage-choice.md';
    const constraintPath = 'architecture/task-rules.md';
    fs.mkdirSync(path.dirname(path.join(dir, decisionPath)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(dir, constraintPath)), { recursive: true });
    fs.writeFileSync(path.join(dir, decisionPath), '\uFEFFDecision: Use SQLite for task coordination.\nRationale: Preserve atomic task transitions.\n');
    fs.writeFileSync(path.join(dir, constraintPath), `\uFEFFDecision-Source: ${decisionPath}\nConstraint: Task updates must use a transactional coordinator.\n`);
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'SQLite task coordination preserves atomic transitions.', [], { artifacts: [decisionPath] });
    memory.remember('architecture', 'The implementation constraint requires transactional task updates.', [], { artifacts: [constraintPath] });
    const server = new HyperSABMemoryMcpServer(dir);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const client = new Client({ name: 'multi-source-evidence-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const ask = async () => {
        const response = await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: 'What storage design was chosen, why, and what implementation constraint follows?' } });
        return JSON.parse(response.content[0].text);
      };
      const packet = await ask();
      expect(packet.compoundAnswer).toMatchObject({ status: 'source_verified', implementationCompliance: 'not_verified' });
      expect(packet.claims).toHaveLength(3);
      expect(packet.claims.map((claim: any) => claim.source.path)).toEqual([decisionPath, decisionPath, constraintPath]);
      expect(packet.claims.map((claim: any) => claim.source.line)).toEqual([1, 2, 2]);
      expect(packet.claims.every((claim: any) => claim.directlyRecorded && claim.source.freshness === 'current' && /^[a-f0-9]{64}$/.test(claim.source.sha256))).toBe(true);
      expect(packet.relationships).toEqual([expect.objectContaining({ status: 'verified', evidence: expect.objectContaining({ path: constraintPath, line: 1, excerpt: `Decision-Source: ${decisionPath}` }) })]);
      expect(packet.compoundAnswer.text).toContain('Preserve atomic task transitions.');
      expect(packet.compoundAnswer.limitation).toContain('implementation compliance');
      const alternate = await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: 'Why was this persistence design selected, and what task update rule is explicitly linked to it?' } });
      expect(JSON.parse(alternate.content[0].text).compoundAnswer.status).toBe('source_verified');

      const conflictingPath = 'architecture/alternate-rule.md';
      fs.writeFileSync(path.join(dir, conflictingPath), `Decision-Source: ${decisionPath}\nConstraint: Task updates may use an uncoordinated write.\n`);
      memory.remember('architecture', 'The conflicting implementation constraint permits uncoordinated task writes.', [], { artifacts: [conflictingPath] });
      const conflict = await ask();
      expect(conflict.compoundAnswer).toBeUndefined();
      expect(conflict.relationships).toEqual([]);
      expect(conflict.claims).toEqual([]);
      const decisionRecord = packet.records.find((record: any) => record.artifacts.includes(decisionPath));
      expect(decisionRecord).toBeDefined();
      await client.callTool({ name: 'hypersabmemory_forget', arguments: { id: decisionRecord.id } });
      const forgotten = await ask();
      expect(forgotten.compoundAnswer).toBeUndefined();
      expect(forgotten.records.some((record: any) => record.id === decisionRecord.id)).toBe(false);
    } finally { await client.close(); }
  });

  it('constructs the MCP server over a temp workspace without throwing', () => {
    const dir = tmpDir();
    expect(() => new HyperSABMemoryMcpServer(dir)).not.toThrow();
  });

  it('parses all four structured remember props from MCP tool args', () => {
    const parsed = parseRememberArgs({
      category: 'bug',
      content: 'Rename failed under AV lock',
      tags: ['windows'],
      intent: 'Make saves crash-safe',
      artifacts: ['src/memory/sqliteStore.ts', 'tests/sqliteStore.test.ts'],
      errorsAndFixes: 'Single retry before direct-write fallback',
      nextSteps: 'Fuzz the rename path'
    });

    expect(parsed.category).toBe('bug');
    expect(parsed.content).toBe('Rename failed under AV lock');
    expect(parsed.tags).toEqual(['windows']);
    expect(parsed.structured).toEqual({
      intent: 'Make saves crash-safe',
      artifacts: ['src/memory/sqliteStore.ts', 'tests/sqliteStore.test.ts'],
      errorsAndFixes: 'Single retry before direct-write fallback',
      nextSteps: 'Fuzz the rename path'
    });
  });

  it('leaves structured undefined for plain remembers (back-compat)', () => {
    const plain = parseRememberArgs({ category: 'general', content: 'plain fact' });
    expect(plain.structured).toBeUndefined();

    const noArgs = parseRememberArgs(undefined);
    expect(noArgs.category).toBe('general');
    expect(noArgs.content).toBe('');
    expect(noArgs.tags).toEqual([]);
    expect(noArgs.structured).toBeUndefined();
  });

  it('persists structured props end-to-end through engine.remember', () => {
    const dir = tmpDir();
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('bug', 'Watcher debounce noisy', [], {
      intent: 'Cut watcher noise',
      artifacts: ['src/hooks/fileWatcher.ts'],
      errorsAndFixes: 'Raised debounce to 30s',
      nextSteps: 'Tune per-OS debounce'
    });

    const record = memory.getActive().find((r) => r.content === 'Watcher debounce noisy');
    expect(record?.intent).toBe('Cut watcher noise');
    expect(record?.artifacts).toEqual(['src/hooks/fileWatcher.ts']);
    expect(record?.errorsAndFixes).toBe('Raised debounce to 30s');
    expect(record?.nextSteps).toBe('Tune per-OS debounce');
  });

  it('classifies verified, unverified source, weak candidate backfill, memory-only, conflicting, stale, and insufficient evidence distinctly', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'prefs.json'), '{\n  "port": 4317\n}\n');
    fs.writeFileSync(
      path.join(dir, 'catalog.ts'),
      'export function resolveCatalog(spec: string) {\n  // catalog version handler\n  return spec;\n}\n'
    );
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'The project stores port configuration locally.', [], { artifacts: ['prefs.json'] });
    memory.remember('architecture', 'Handles pnpm catalog version protocol resolution.', [], { artifacts: ['catalog.ts'] });
    memory.remember('general', 'Recorded discussion on stripe billing gateway without source file.');

    const server = new HyperSABMemoryMcpServer(dir);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const client = new Client({ name: 'classification-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const ask = async (query: string) => {
      const res = await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query, limit: 5 } });
      return JSON.parse(res.content[0].text);
    };

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const verified = await ask('What port is configured for the local service?');
      expect(verified.answerVerified).toBe(true);
      expect(verified.evidenceClassification).toBe('verified_answer');
      expect(verified.evidenceSummary).toMatchObject({ verifiedAssertions: 1, groundedSourceExcerpts: 1, weakCandidateExcerpts: 0 });

      const unverifiedSource = await ask('How does resolveCatalog handle catalog version resolution?');
      expect(unverifiedSource.status).toBe('evidence_found');
      expect(unverifiedSource.answerVerified).toBe(false);
      expect(unverifiedSource.evidenceClassification).toBe('unverified_source_evidence');
      expect(unverifiedSource.evidenceSummary.groundedSourceExcerpts).toBeGreaterThanOrEqual(1);

      const noisyUnanswerable = await ask('Which PostgreSQL schema migration runner does it use for version tracking?');
      expect(noisyUnanswerable.answerVerified).toBe(false);
      expect(noisyUnanswerable.evidenceClassification).toBe('memory_only_no_source_evidence');
      expect(noisyUnanswerable.evidence).toEqual([]);
      expect(noisyUnanswerable.evidenceSummary).toMatchObject({ groundedSourceExcerpts: 0, verifiedAssertions: 0, weakCandidateExcerpts: 0 });

      const weakCandidate = await ask('What catalog version rollback strategy, migration policy, and pipeline does it use?');
      expect(weakCandidate.status).toBe('evidence_found');
      expect(weakCandidate.answerVerified).toBe(false);
      expect(weakCandidate.evidenceClassification).toBe('weak_lexical_candidates');
      expect(weakCandidate.evidenceSummary).toMatchObject({ groundedSourceExcerpts: 0, verifiedAssertions: 0 });
      expect(weakCandidate.evidenceSummary.weakCandidateExcerpts).toBeGreaterThanOrEqual(1);
      expect(weakCandidate.limitations.join(' ')).toContain('weak lexical backfill candidates');

      const memoryOnly = await ask('What stripe billing gateway note was recorded?');
      expect(memoryOnly.status).toBe('evidence_found');
      expect(memoryOnly.answerVerified).toBe(false);
      expect(memoryOnly.evidenceClassification).toBe('memory_only_no_source_evidence');
      expect(memoryOnly.limitations.join(' ')).toContain('agent-authored memory records');

      const missing = await ask('Where are Kubernetes Helm charts deployed?');
      expect(missing.status).toBe('insufficient_evidence');
      expect(missing.answerVerified).toBe(false);
      expect(missing.evidenceClassification).toBe('insufficient_evidence');

      fs.writeFileSync(path.join(dir, 'secondary.json'), '{\n  "port": 4318\n}\n');
      memory.remember('decision', 'The project port is 4318.', [], { artifacts: ['secondary.json'] });
      const conflict = await ask('What port is configured for the local service?');
      expect(conflict.status).toBe('evidence_found');
      expect(conflict.answerVerified).toBe(false);
      expect(conflict.evidenceClassification).toBe('conflicting_evidence');
      expect(conflict.limitations.join(' ')).toContain('Conflicting evidence');
    } finally {
      await client.close();
    }

    expect(classifyQueryEvidence({
      groundedStatus: 'STALE_EVIDENCE',
      canAssert: false,
      assertionsCount: 0,
      recordsCount: 1,
      groundedSourceExcerpts: 0,
      weakCandidateExcerpts: 0,
      staleSourcesCount: 1,
      implementationCodeCount: 0
    })).toBe('stale_evidence');
  });

  it('calls searchRecordsWithScores once, suppresses near-miss backfill noise, and catches mid-request same-size mutations', async () => {
    const dir = tmpDir();
    const targetPath = path.join(dir, 'service.ts');
    const readmePath = path.join(dir, 'README.md');
    const initialService = 'export function resolveCatalog(spec: string) {\n  // catalog version resolution pipeline\n  return spec;\n}\n';
    const rewrittenService = 'export function resolveCatalog(spec: string) {\n  // catalog version resolution pipeXine\n  return spec;\n}\n';
    expect(Buffer.byteLength(rewrittenService)).toBe(Buffer.byteLength(initialService));
    fs.writeFileSync(targetPath, initialService);
    fs.writeFileSync(readmePath, '# Service Guide\n\nConfigure retry intervals, store updates, clean stores, and lifecycle batching.\n');
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('architecture', 'resolveCatalog catalog version resolution pipeline', [], { artifacts: ['service.ts'] });
    memory.remember('general', 'Configure retry intervals, store updates, clean stores, and lifecycle batching.', [], { artifacts: ['README.md'] });

    const server = new HyperSABMemoryMcpServer(dir);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const client = new Client({ name: 'mcp-opt-noise-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const searchSpy = vi.spyOn(HybridSearchEngine.prototype, 'searchRecordsWithScores');
      const nearMissRes = await client.callTool({
        name: 'hypersabmemory_query_evidence',
        arguments: { query: 'How does retryBackoffMs configure clean stores and lifecycle batching in the guide?' }
      });
      const nearMiss = JSON.parse(nearMissRes.content[0].text);
      expect(searchSpy).toHaveBeenCalledTimes(1);
      expect(nearMiss.evidence).toEqual([]);
      expect(nearMiss.evidenceSummary.weakCandidateExcerpts).toBe(0);
      expect(nearMiss.answerVerified).toBe(false);
      searchSpy.mockRestore();

      const origRead = fsDefault.readFileSync;
      let mutatedAfterCapture = false;
      const readSpy = vi.spyOn(fsDefault, 'readFileSync').mockImplementation(((file: Parameters<typeof origRead>[0], options?: Parameters<typeof origRead>[1]) => {
        const result = origRead(file, options);
        if (matchesTargetFile(file, targetPath) && !mutatedAfterCapture) {
          mutatedAfterCapture = true;
          fs.writeFileSync(targetPath, rewrittenService);
        }
        return result;
      }) as typeof origRead);
      syncBuiltinESMExports();
      try {
        const staleRes = await client.callTool({
          name: 'hypersabmemory_query_evidence',
          arguments: { query: 'How does resolveCatalog handle catalog version resolution pipeline?' }
        });
        const stalePacket = JSON.parse(staleRes.content[0].text);
        expect(mutatedAfterCapture).toBe(true);
        expect(stalePacket.evidence.some((item: any) => item.source.path === 'service.ts')).toBe(false);
        expect(stalePacket.staleSources).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'service.ts', status: 'modified' })]));
      } finally {
        readSpy.mockRestore();
        syncBuiltinESMExports();
      }
    } finally {
      await client.close();
    }
  });
});
