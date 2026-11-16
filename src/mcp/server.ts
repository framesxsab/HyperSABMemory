/**
 * HyperSABMemory — Model Context Protocol (MCP) Server
 * Exposes the HyperSABMemory context harness and temporal memory tools to AI coding agents via MCP standard.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { TemporalMemoryEngine } from '../memory/temporalMemory.js';
import { StructuralGraphEngine } from '../memory/structuralGraph.js';
import { HybridSearchEngine, HybridSearchResult } from '../memory/hybridSearch.js';
import { SwarmMeshEngine } from '../memory/swarmMesh.js';
import { TaskLedger } from '../memory/taskLedger.js';
import { captureTaskSources, inspectTaskSourceContents } from '../harness/taskSources.js';
import { excerptFor, searchGrounded } from '../memory/groundedSearch.js';
import { TASK_TOOLS, TASK_LIST_RESOURCE, executeTaskTool, listActiveTasks } from './taskTools.js';
import { MemoryRecord, StructuredMemory } from '../memory/sqliteStore.js';
import { ContextHarness } from '../harness/contextHarness.js';
import { AutoCommitEngine } from '../hooks/autoCommit.js';
import { UniversalAdaptersEngine } from '../harness/universalAdapters.js';
import { getPackageVersion } from '../version.js';
import * as fs from 'fs';
import * as path from 'path';

export type QuerySource = 'memory' | 'graph' | 'all';

/**
 * Maps structural knowledge graph hits onto synthetic MemoryRecord shape so the MCP
 * query response stays MemoryRecord-compatible. Response-only: never persisted.
 */
export function mapGraphHitsToRecords(hits: HybridSearchResult[]): MemoryRecord[] {
  return hits
    .filter((hit) => hit.source === 'graph')
    .map((hit) => {
      const idx = hit.title.indexOf('] ');
      const name = idx >= 0 ? hit.title.slice(idx + 2) : hit.title;
      return {
        id: `graph_${name}`,
        category: 'symbol' as const,
        content: hit.snippet,
        timestamp: new Date().toISOString(),
        status: 'active' as const
      };
    });
}

/**
 * Shared query pipeline: memory leg first (byte-identical ranking to the
 * pre-source-field behavior), then graph synthetics filling remaining slots.
 */
export function selectQueryRecords(
  hybrid: HybridSearchEngine,
  query: string,
  limit: number,
  source: QuerySource
): MemoryRecord[] {
  if (source === 'graph') {
    return mapGraphHitsToRecords(hybrid.search(query, limit));
  }

  const memoryLeg = hybrid.searchRecords(query, limit);
  if (source === 'memory') return memoryLeg;

  const remaining = Math.max(0, limit - memoryLeg.length);
  if (remaining === 0) return memoryLeg;
  const graphLeg = mapGraphHitsToRecords(hybrid.search(query, limit));
  return [...memoryLeg, ...graphLeg.slice(0, remaining)];
}

export interface ParsedRememberArgs {
  category: MemoryRecord['category'];
  content: string;
  tags: string[];
  structured?: StructuredMemory;
}

/**
 * Extracts hypersabmemory_remember tool args; structured is undefined when none
 * of the four optional dimensions are present so plain remembers stay back-compat.
 */
export function parseRememberArgs(args: Record<string, unknown> | undefined): ParsedRememberArgs {
  const category = ((args?.category as string) || 'general') as MemoryRecord['category'];
  const content = (args?.content as string) || '';
  const tags = (args?.tags as string[]) || [];
  const intent = args?.intent as string | undefined;
  const artifacts = args?.artifacts as string[] | undefined;
  const errorsAndFixes = args?.errorsAndFixes as string | undefined;
  const nextSteps = args?.nextSteps as string | undefined;
  const hasStructured = Boolean(
    intent || (artifacts && artifacts.length > 0) || errorsAndFixes || nextSteps
  );
  return {
    category,
    content,
    tags,
    structured: hasStructured ? { intent, artifacts, errorsAndFixes, nextSteps } : undefined
  };
}

/**
 * Contains activeFile inside the workspace: escaping paths (../ or absolute
 * outside workspaceDir) resolve to undefined instead of a readable file.
 */
export function resolveActiveFilePath(workspaceDir: string, activeFile: string): string | undefined {
  const resolved = path.resolve(workspaceDir, activeFile);
  const rel = path.relative(workspaceDir, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return resolved;
}

export class HyperSABMemoryMcpServer {
  private server: Server;
  private memory: TemporalMemoryEngine;
  private harness: ContextHarness;
  private autoCommit: AutoCommitEngine;
  private graph: StructuralGraphEngine;
  private hybridSearch: HybridSearchEngine;
  private swarm: SwarmMeshEngine;
  private tasks: TaskLedger;
  private workspaceDir: string;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = workspaceDir;
    this.memory = new TemporalMemoryEngine(workspaceDir);
    this.harness = new ContextHarness(1500);
    this.autoCommit = new AutoCommitEngine({
      workspaceDir
    });
    this.graph = new StructuralGraphEngine(workspaceDir);
    this.hybridSearch = new HybridSearchEngine(workspaceDir, this.memory, this.graph);
    this.swarm = new SwarmMeshEngine(workspaceDir);
    this.tasks = new TaskLedger(workspaceDir);

    this.server = new Server(
      {
        name: 'hypersabmemory-mcp',
        version: getPackageVersion()
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        }
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available MCP tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'hypersabmemory_get_context',
            description: 'Get active context harness state header and token-compressed context snapshot.',
            inputSchema: {
              type: 'object',
              properties: {
                activeFile: { type: 'string', description: 'Currently focused file path' },
                cursorLine: { type: 'number', description: 'Cursor line position' }
              }
            }
          },
          {
            name: 'hypersabmemory_remember',
            description: 'Save a persistent architectural memory or key decision into the temporal memory store. Optional structured dimensions: intent (why it happened), artifacts (files/modules involved), errorsAndFixes (what broke and the fix), nextSteps (what remains open).',
            inputSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  enum: ['architecture', 'decision', 'bug', 'symbol', 'general'],
                  description: 'Memory category'
                },
                content: { type: 'string', description: 'Insight or decision content' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Searchable tags' },
                intent: { type: 'string', description: 'Why the work/decision happened' },
                artifacts: { type: 'array', items: { type: 'string' }, description: 'Files/modules involved' },
                errorsAndFixes: { type: 'string', description: 'What broke and how it was fixed' },
                nextSteps: { type: 'string', description: 'What remains open' }
              },
              required: ['category', 'content']
            }
          },
          {
            name: 'hypersabmemory_checkpoint',
            description: 'Trigger an immediate hyperfrequent git checkpoint commit.',
            inputSchema: {
              type: 'object',
              properties: {
                reason: { type: 'string', description: 'Reason or summary of changes checkpointed' }
              }
            }
          },
          {
            name: 'hypersabmemory_query',
            description: 'Search the persistent temporal memory store for relevant decisions or symbols.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search terms' },
                limit: { type: 'number', description: 'Max results (default 10)' },
                source: {
                  type: 'string',
                  enum: ['memory', 'graph', 'all'],
                  description: 'Which result legs to include (default all: memories first, then graph symbols)'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'hypersabmemory_query_evidence',
            description: 'Retrieve bounded active memory records and hash-checked excerpts from their referenced files for a project question. Recorded memory is not proof; assertions appear only for existing deterministic verification rules. Other relationships and conclusions remain unverified.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', minLength: 1 },
                limit: { type: 'integer', minimum: 1, maximum: 5 }
              },
              required: ['query'],
              additionalProperties: false
            }
          },
          {
            name: 'hypersabmemory_forget',
            description: 'Invalidate a memory by id (merge/forget). Forgotten facts drop out of Context Block.',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Memory record id' }
              },
              required: ['id']
            }
          },
          {
            name: 'hypersabmemory_context_block',
            description: 'Return a token-packed Context Block of dated active facts for the context harness header.',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'hypersabmemory_inject_adapters',
            description: 'Ingest native IDE rule files and auto-inject HyperSABMemory plus the current Context Block.',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'hypersabmemory_broadcast',
            description: 'Broadcast a fact or finding to the shared swarm mesh so parallel subagents stop duplicating work.',
            inputSchema: {
              type: 'object',
              properties: {
                message: { type: 'string', description: 'The finding or fact to share' },
                category: { type: 'string', description: 'Optional category tag' }
              },
              required: ['message']
            }
          },
          {
            name: 'hypersabmemory_claim_task',
            description: 'Acquire or release an exclusive lock on a file so concurrent agents do not edit it simultaneously.',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: { type: 'string', description: 'File path relative to workspace' },
                action: { type: 'string', enum: ['acquire', 'release'], description: 'acquire (default) or release the lock' },
                ttlMinutes: { type: 'number', description: 'Lock lifetime in minutes (default 10)' }
              },
              required: ['filePath']
            }
          },
          {
            name: 'hypersabmemory_sync_swarm',
            description: 'Return active swarm state: live file locks, recent broadcasts, and this caller session id.',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: { type: 'string', description: 'Optional explicit caller session id' }
              }
            }
          },
          ...TASK_TOOLS
        ]
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const taskResult = executeTaskTool(this.workspaceDir, this.tasks, name, args);
        if (taskResult) return taskResult;

        if (name === 'hypersabmemory_get_context') {
          const activeFile = (args?.activeFile as string) || '';
          const cursorLine = (args?.cursorLine as number) || 1;

          let activeFileContent: string | undefined;
          if (activeFile) {
            const filePath = resolveActiveFilePath(this.workspaceDir, activeFile);
            if (filePath && fs.existsSync(filePath)) {
              try {
                activeFileContent = fs.readFileSync(filePath, 'utf-8').split('\n').slice(0, 200).join('\n');
              } catch {
                activeFileContent = undefined;
              }
            }
          }

          const snapshot = await this.autoCommit.getSnapshot();
          const header = this.harness.generateHeader({
            workspaceName: path.basename(this.workspaceDir),
            activeFile: activeFile || undefined,
            cursorLine,
            gitBranch: snapshot.gitBranch,
            lastCommitHash: snapshot.lastCommitHash,
            lastCommitTime: snapshot.lastCommitTime,
            modifiedFiles: snapshot.modifiedFiles,
            recentDiff: snapshot.recentDiff,
            memorySummary: this.memory.getSummary(),
            contextBlock: this.memory.getContextBlock(),
            structuralGraphSummary: this.graph.getGraphSummary(),
            activeFileContent
          });
          return { content: [{ type: 'text', text: header }] };
        }

        if (name === 'hypersabmemory_remember') {
          const parsed = parseRememberArgs(args as Record<string, unknown> | undefined);
          const record = this.memory.remember(parsed.category, parsed.content, parsed.tags, parsed.structured);
          return { content: [{ type: 'text', text: `Saved memory ID [${record.id}]: ${record.content}` }] };
        }

        if (name === 'hypersabmemory_checkpoint') {
          const reason = (args?.reason as string) || 'Manual MCP Checkpoint';
          const result = await this.autoCommit.createCheckpoint(reason);
          return {
            content: [{ 
              type: 'text', 
              text: result.committed ? `Checkpoint created: ${result.hash}` : 'No uncommitted changes to checkpoint.' 
            }]
          };
        }

        if (name === 'hypersabmemory_query') {
          const query = (args?.query as string) || '';
          const limit = Number.isFinite(args?.limit) ? (args?.limit as number) : 10;
          const source = (args?.source as QuerySource) || 'all';
          const results = selectQueryRecords(this.hybridSearch, query, limit, source);
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }

        if (name === 'hypersabmemory_query_evidence') {
          const query = typeof args?.query === 'string' ? args.query.trim() : '';
          if (!query) throw new Error('query must be a non-empty string');
          const limit = Number.isInteger(args?.limit) ? Math.min(Math.max(args?.limit as number, 1), 5) : 5;
          const ranked = this.hybridSearch.searchRecordsWithScores(query, 20);
          const records = ranked.slice(0, limit).map(({ record, score }) => ({
            id: record.id,
            category: record.category,
            statement: record.content.slice(0, 320),
            timestamp: record.timestamp,
            artifacts: (record.artifacts ?? []).slice(0, 5),
            rankScore: score,
            attribution: 'recorded_memory'
          }));
          const references = new Map<string, { path: string; sha256: string }>();
          for (const { record } of ranked) {
            for (const sourcePath of record.artifacts ?? []) {
              if (references.size >= 64) break;
              try {
                const captured = captureTaskSources(this.workspaceDir, [sourcePath])[0];
                if (captured?.sha256) references.set(captured.path, captured);
              } catch {}
            }
            if (references.size >= 64) break;
          }
          const grounded = searchGrounded(this.hybridSearch, this.workspaceDir, query, [...references.values()]);
          const evidence = grounded.evidence.slice(0, limit).map(item => ({
            excerpt: item.excerpt ?? '',
            source: { path: item.source.path, sha256: item.source.currentSha256, freshness: item.source.status, ...(item.line ? { line: item.line } : {}) },
            supportType: 'retrieved_source_excerpt',
            verification: 'source_hash_verified',
            lexicalSupport: item.lexicalSupport
          }));
          const included = new Set(evidence.map(item => item.source.path));
          for (const reference of references.values()) {
            if (evidence.length >= limit || included.has(reference.path)) continue;
            const inspected = inspectTaskSourceContents(this.workspaceDir, [reference])[0];
            if (inspected.status !== 'current' || !inspected.content) continue;
            const excerpt = excerptFor(query, inspected.content.toString('utf8'), reference.path);
            if (!excerpt) continue;
            const checked = inspectTaskSourceContents(this.workspaceDir, [reference])[0];
            if (checked.status !== 'current') continue;
            const line = checked.content?.toString('utf8').indexOf(excerpt) ?? -1;
            evidence.push({
              excerpt,
              source: { path: reference.path, sha256: checked.currentSha256, freshness: checked.status, ...(line >= 0 ? { line: checked.content!.toString('utf8').slice(0, line).split('\n').length } : {}) },
              supportType: 'candidate_excerpt',
              verification: 'insufficient_evidence',
              lexicalSupport: 0
            });
            included.add(reference.path);
          }
          const limitations = [
            'Recorded memory statements are agent-authored and are not independently verified.',
            'Lexical relevance does not prove that evidence entails the question or that related files have an established relationship.',
            'Recorded decisions do not establish implementation compliance or independently verified causality.',
            'Freshness is checked against bytes captured for this request; this does not establish when a memory statement was originally recorded.'
          ];
          if (!grounded.assertions.length) limitations.push('No supported assertion was established by the deterministic verifier.');
          return { content: [{ type: 'text', text: JSON.stringify({
            question: query,
            status: evidence.length || records.length ? 'evidence_found' : grounded.status === 'STALE_EVIDENCE' ? 'stale_only' : 'insufficient_evidence',
            records,
            evidence,
            assertions: grounded.assertions,
            relationships: [],
            staleSources: grounded.staleSources,
            limitations,
            answerVerified: grounded.canAssert
          }, null, 2) }] };
        }

        if (name === 'hypersabmemory_forget') {
          const id = (args?.id as string) || '';
          const forgotten = this.memory.forget(id);
          return {
            content: [{
              type: 'text',
              text: forgotten ? `Forgot memory [${forgotten.id}]` : `No memory found for id ${id}`
            }]
          };
        }

        if (name === 'hypersabmemory_context_block') {
          return { content: [{ type: 'text', text: this.memory.getContextBlock() }] };
        }

        if (name === 'hypersabmemory_inject_adapters') {
          const adapters = new UniversalAdaptersEngine(this.workspaceDir);
          const result = adapters.syncAllAdapters({
            contextBlock: this.memory.getContextBlock()
          });
          return {
            content: [{
              type: 'text',
              text: `Injected ${result.createdFiles.length} adapter files. Ingested ${result.ingested.length} native rules.`
            }]
          };
        }

        if (name === 'hypersabmemory_broadcast') {
          const message = (args?.message as string) || '';
          if (!message.trim()) {
            return { content: [{ type: 'text', text: 'Error: message is required' }], isError: true };
          }
          const broadcast = this.swarm.broadcast(undefined, message, (args?.category as string) || undefined);
          return {
            content: [{
              type: 'text',
              text: `Broadcast [${broadcast.id}] shared to swarm: ${broadcast.message}`
            }]
          };
        }

        if (name === 'hypersabmemory_claim_task') {
          const filePath = (args?.filePath as string) || '';
          if (!filePath) {
            return { content: [{ type: 'text', text: 'Error: filePath is required' }], isError: true };
          }
          const action = (args?.action as string) || 'acquire';
          const ttlMs = Number.isFinite(args?.ttlMinutes) ? (args?.ttlMinutes as number) * 60_000 : undefined;
          const result = action === 'release'
            ? this.swarm.releaseFile(undefined, filePath)
            : this.swarm.claimFile(undefined, filePath, ttlMs);
          return {
            content: [{
              type: 'text',
              text: result.ok
                ? `Lock ${action === 'release' ? 'released' : 'acquired'} on ${filePath}`
                : `Lock denied on ${filePath}: ${result.reason}${result.heldBy ? ` (held by ${result.heldBy})` : ''}`
            }]
          };
        }

        if (name === 'hypersabmemory_sync_swarm') {
          const snapshot = this.swarm.sync((args?.sessionId as string) || undefined);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(snapshot, null, 2)
            }]
          };
        }

        throw new Error(`Unknown tool: ${name}`);
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });

    // List exposed MCP resources (additive capability; tool responses unchanged)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'hypersabmemory://context-block',
            name: 'Context Block',
            description: 'Token-packed Context Block of dated active facts (same content as the hypersabmemory_context_block tool).',
            mimeType: 'text/plain'
          },
          {
            uri: 'hypersabmemory://memory-log',
            name: 'Memory Log',
            description: 'Persistent decision log (Memory.md) at the workspace root.',
            mimeType: 'text/markdown'
          },
          TASK_LIST_RESOURCE
        ]
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {      const { uri } = request.params;

      if (uri === TASK_LIST_RESOURCE.uri) {
        return {
          contents: [{ uri, mimeType: TASK_LIST_RESOURCE.mimeType, text: JSON.stringify(listActiveTasks(this.tasks), null, 2) }]
        };
      }

      if (uri === 'hypersabmemory://context-block') {
        return {
          contents: [{ uri, mimeType: 'text/plain', text: this.memory.getContextBlock() }]
        };
      }

      if (uri === 'hypersabmemory://memory-log') {
        const logPath = path.join(this.workspaceDir, 'Memory.md');
        const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
        return {
          contents: [{ uri, mimeType: 'text/markdown', text }]
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });
  }

  public connect(transport: Transport): Promise<void> {
    return this.server.connect(transport);
  }

  public async start(): Promise<void> {
    await this.connect(new StdioServerTransport());
  }
}
