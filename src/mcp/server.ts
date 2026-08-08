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
import { OhMyPiHarness } from '../harness/ohMyPi.js';
import { AutoCommitEngine } from '../hooks/autoCommit.js';

export class HyperMemoryMcpServer {
  private server: Server;
  private supermemory: SupermemoryEngine;
  private harness: OhMyPiHarness;
  private autoCommit: AutoCommitEngine;

  constructor(workspaceDir: string = process.cwd()) {
    this.supermemory = new SupermemoryEngine(workspaceDir);
    this.harness = new OhMyPiHarness(1500);
    this.autoCommit = new AutoCommitEngine({
      workspaceDir
    });

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
          }
        ]
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'hypermemory_get_context') {
          const activeFile = (args?.activeFile as string) || 'None';
          const cursorLine = (args?.cursorLine as number) || 1;
          const header = this.harness.generateHeader({
            workspaceName: 'HyperMemory',
            activeFile,
            cursorLine,
            modifiedFiles: [],
            memorySummary: this.supermemory.getSummary()
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
