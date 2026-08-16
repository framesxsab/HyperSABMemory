/**
 * HyperMemory — Model Context Protocol (MCP) Server
 * Exposes HyperMemory context harness and Supermemory tools to AI coding agents via MCP standard.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { SupermemoryEngine } from '../memory/supermemory.js';
import { GraphifyEngine } from '../memory/graphify.js';
import { OhMyPiHarness } from '../harness/ohMyPi.js';
import { AutoCommitEngine } from '../hooks/autoCommit.js';
import { UniversalAdaptersEngine } from '../harness/universalAdapters.js';
import * as fs from 'fs';
import * as path from 'path';

export class HyperMemoryMcpServer {
  private server: Server;
  private supermemory: SupermemoryEngine;
  private harness: OhMyPiHarness;
  private autoCommit: AutoCommitEngine;
  private graphify: GraphifyEngine;
  private workspaceDir: string;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = workspaceDir;
    this.supermemory = new SupermemoryEngine(workspaceDir);
    this.harness = new OhMyPiHarness(1500);
    this.autoCommit = new AutoCommitEngine({
      workspaceDir
    });
    this.graphify = new GraphifyEngine(workspaceDir);

    this.server = new Server(
      {
        name: 'hypermemory-mcp',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
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
            name: 'hypermemory_get_context',
            description: 'Get active Oh-My-Pi state harness header and token-compressed context snapshot.',
            inputSchema: {
              type: 'object',
              properties: {
                activeFile: { type: 'string', description: 'Currently focused file path' },
                cursorLine: { type: 'number', description: 'Cursor line position' }
              }
            }
          },
          {
            name: 'hypermemory_remember',
            description: 'Save a persistent architectural memory or key decision into Supermemory base.',
            inputSchema: {
              type: 'object',
              properties: {
                category: { 
                  type: 'string', 
                  enum: ['architecture', 'decision', 'bug', 'symbol', 'general'],
                  description: 'Memory category' 
                },
                content: { type: 'string', description: 'Insight or decision content' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Searchable tags' }
              },
              required: ['category', 'content']
            }
          },
          {
            name: 'hypermemory_checkpoint',
            description: 'Trigger an immediate hyperfrequent git checkpoint commit.',
            inputSchema: {
              type: 'object',
              properties: {
                reason: { type: 'string', description: 'Reason or summary of changes checkpointed' }
              }
            }
          },
          {
            name: 'hypermemory_query',
            description: 'Search persistent Supermemory store for relevant decisions or symbols.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search terms' }
              },
              required: ['query']
            }
          },
          {
            name: 'hypermemory_forget',
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
            name: 'hypermemory_context_block',
            description: 'Return a token-packed Context Block of dated active facts for the Oh-My-Pi header.',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'hypermemory_inject_adapters',
            description: 'Ingest native IDE rule files and auto-inject HyperMemory plus the current Context Block.',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'hypermemory_get_context') {
          const activeFile = (args?.activeFile as string) || '';
          const cursorLine = (args?.cursorLine as number) || 1;

          let activeFileContent: string | undefined;
          if (activeFile) {
            const filePath = path.join(this.workspaceDir, activeFile);
            if (fs.existsSync(filePath)) {
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
            memorySummary: this.supermemory.getSummary(),
            contextBlock: this.supermemory.getContextBlock(),
            graphifySummary: this.graphify.getGraphSummary(),
            activeFileContent
          });
          return { content: [{ type: 'text', text: header }] };
        }

        if (name === 'hypermemory_remember') {
          const category = (args?.category as any) || 'general';
          const content = (args?.content as string) || '';
          const tags = (args?.tags as string[]) || [];
          const record = this.supermemory.remember(category, content, tags);
          return { content: [{ type: 'text', text: `Saved memory ID [${record.id}]: ${record.content}` }] };
        }

        if (name === 'hypermemory_checkpoint') {
          const reason = (args?.reason as string) || 'Manual MCP Checkpoint';
          const result = await this.autoCommit.createCheckpoint(reason);
          return {
            content: [{ 
              type: 'text', 
              text: result.committed ? `Checkpoint created: ${result.hash}` : 'No uncommitted changes to checkpoint.' 
            }]
          };
        }

        if (name === 'hypermemory_query') {
          const query = (args?.query as string) || '';
          const results = this.supermemory.query(query);
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }

        if (name === 'hypermemory_forget') {
          const id = (args?.id as string) || '';
          const forgotten = this.supermemory.forget(id);
          return {
            content: [{
              type: 'text',
              text: forgotten ? `Forgot memory [${forgotten.id}]` : `No memory found for id ${id}`
            }]
          };
        }

        if (name === 'hypermemory_context_block') {
          return { content: [{ type: 'text', text: this.supermemory.getContextBlock() }] };
        }

        if (name === 'hypermemory_inject_adapters') {
          const adapters = new UniversalAdaptersEngine(this.workspaceDir);
          const result = adapters.syncAllAdapters({
            contextBlock: this.supermemory.getContextBlock()
          });
          return {
            content: [{
              type: 'text',
              text: `Injected ${result.createdFiles.length} adapter files. Ingested ${result.ingested.length} native rules.`
            }]
          };
        }

        throw new Error(`Unknown tool: ${name}`);
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    });
  }

  public async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
