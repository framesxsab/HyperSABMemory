/**
 * HyperSABMemory — Live Web Dashboard & Local API Server
 * Hosts a zero-latency Web Visualizer at http://localhost:4321
 * Exposes status, hybrid search, git history, live context harness header,
 * structural graph data, and guarded rollback.
 */

import * as http from 'http';
import * as path from 'path';
import { TemporalMemoryEngine } from '../memory/temporalMemory.js';
import { StructuralGraphEngine } from '../memory/structuralGraph.js';
import { AutoCommitEngine } from '../hooks/autoCommit.js';
import { HybridSearchEngine } from '../memory/hybridSearch.js';
import { ContextHarness } from '../harness/contextHarness.js';
import { TokenCompressor } from '../harness/tokenCompressor.js';

const TOKEN_CEILING = 1500;

export class DashboardServer {
  private port: number;
  private workspaceDir: string;
  private server: http.Server | null = null;
  private memory: TemporalMemoryEngine;
  private graph: StructuralGraphEngine;
  private autoCommit: AutoCommitEngine;
  private hybridSearch: HybridSearchEngine;
  private harness: ContextHarness;

  constructor(port: number = 4321, workspaceDir: string = process.cwd()) {
    this.port = port;
    this.workspaceDir = workspaceDir;
    this.memory = new TemporalMemoryEngine(workspaceDir);
    this.graph = new StructuralGraphEngine(workspaceDir);
    this.autoCommit = new AutoCommitEngine({
      workspaceDir
    });
    this.hybridSearch = new HybridSearchEngine(workspaceDir, this.memory, this.graph);
    this.harness = new ContextHarness(TOKEN_CEILING);
  }

  /**
   * Builds a live context harness header (same shape as MCP hypersabmemory_get_context).
   */
  private async buildLiveHeader(): Promise<string> {
    const snapshot = await this.autoCommit.getSnapshot();
    return this.harness.generateHeader({
      workspaceName: path.basename(this.workspaceDir),
      modifiedFiles: snapshot.modifiedFiles,
      gitBranch: snapshot.gitBranch,
      lastCommitHash: snapshot.lastCommitHash,
      lastCommitTime: snapshot.lastCommitTime,
      recentDiff: snapshot.recentDiff,
      memorySummary: this.memory.getSummary(),
      contextBlock: this.memory.getContextBlock(),
      structuralGraphSummary: this.graph.getGraphSummary()
    });
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf-8'); });
      req.on('end', () => resolve(body));
    });
  }

  /**
   * Starts the HTTP dashboard server. Resolves with the bound port.
   */
  public start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${this.port}`);

        // No CORS headers on purpose: the dashboard is a localhost-only,
        // same-origin surface (127.0.0.1 bind); wildcard would let any
        // website's JS read local workspace data via the browser.

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // Endpoint: /api/status
        if (url.pathname === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'online',
            workspace: this.workspaceDir,
            graph: this.graph.getGraphSummary(),
            memory: this.memory.getSummary(),
            timestamp: new Date().toISOString()
          }));
          return;
        }

        // Endpoint: /api/search
        if (url.pathname === '/api/search') {
          const q = url.searchParams.get('q') || '';
          const results = this.hybridSearch.search(q);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(results));
          return;
        }

        // Endpoint: /api/history
        if (url.pathname === '/api/history') {
          const history = await this.autoCommit.getHistory(15);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(history));
          return;
        }

        // Endpoint: /api/context (live context harness header + token meter)
        if (url.pathname === '/api/context') {
          const header = await this.buildLiveHeader();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            header,
            tokens: TokenCompressor.estimateTokens(header),
            ceiling: TOKEN_CEILING
          }));
          return;
        }

        // Endpoint: /api/graph (structural graph nodes + derived dependency edges)
        if (url.pathname === '/api/graph') {
          const data = this.graph.getGraphData();
          const edges = data.nodes.flatMap((node) =>
            (node.dependencies ?? []).map((dep) => ({ source: node.name, target: dep }))
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ nodes: data.nodes, edges }));
          return;
        }

        // Endpoint: POST /api/rollback (guarded; bound to 127.0.0.1 only)
        if (url.pathname === '/api/rollback' && req.method === 'POST') {
          const body = await this.readBody(req);
          try {
            const parsed = JSON.parse(body || '{}') as { hash?: string };
            const ok = parsed.hash ? await this.autoCommit.rollback(parsed.hash) : false;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok }));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
          }
          return;
        }

        // Endpoint: / (HTML Dashboard)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>⚡ HyperSABMemory Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0B0F19; color: #E2E8F0; margin: 0; padding: 20px; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1E293B; padding-bottom: 15px; margin-bottom: 20px; }
    .badge { background: #00F0FF; color: #0B0F19; font-weight: bold; padding: 4px 10px; border-radius: 12px; font-size: 12px; }
    .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .card { background: #161C2E; border: 1px solid #1E293B; border-radius: 8px; padding: 20px; }
    .card h3 { color: #00F0FF; margin-top: 0; }
    pre { background: #0F172A; padding: 12px; border-radius: 6px; overflow-x: auto; color: #38BDF8; font-size: 13px; }
    .meter-wrap { background: #0F172A; border-radius: 6px; height: 14px; overflow: hidden; margin-top: 10px; }
    .meter-bar { background: #00F0FF; height: 100%; width: 0%; transition: width 0.4s ease; }
    .graph-list { list-style: none; padding: 0; margin: 0; max-height: 240px; overflow-y: auto; }
    .graph-list li { padding: 6px 8px; border-bottom: 1px solid #1E293B; font-size: 13px; }
    .graph-list .type { color: #00F0FF; font-size: 11px; text-transform: uppercase; margin-right: 6px; }
    .history-list { list-style: none; padding: 0; margin: 0; max-height: 240px; overflow-y: auto; }
    .history-list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 8px; border-bottom: 1px solid #1E293B; font-size: 13px; }
    .history-list code { color: #38BDF8; }
    button.rollback { background: #7F1D1D; color: #FCA5A5; border: 1px solid #991B1B; border-radius: 6px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
    button.rollback:hover { background: #991B1B; }
  </style>
</head>
<body>
  <div class="header">
    <h1>⚡ HyperSABMemory Live Dashboard</h1>
    <span class="badge">SYSTEM ONLINE</span>
  </div>
  <div class="card-grid">
    <div class="card">
      <h3>⚡ Context Harness Token Meter</h3>
      <p id="token-meter">Loading live context header...</p>
      <div class="meter-wrap"><div class="meter-bar" id="token-bar"></div></div>
    </div>
    <div class="card">
      <h3>🕸️ Structural Knowledge Graph</h3>
      <p id="graph-status">Loading structural graph nodes...</p>
      <ul class="graph-list" id="graph-list"></ul>
    </div>
    <div class="card">
      <h3>🧠 Temporal Memory Store</h3>
      <p id="memory-status">Loading memory log...</p>
    </div>
    <div class="card">
      <h3>🕒 Git Auto-Commit Timeline</h3>
      <ul class="history-list" id="history-log">Fetching git checkpoints...</ul>
    </div>
  </div>
  <script>
    async function loadData() {
      const res = await fetch('/api/status');
      const data = await res.json();
      document.getElementById('graph-status').textContent = data.graph;
      document.getElementById('memory-status').textContent = data.memory;
    }
    async function loadContext() {
      const res = await fetch('/api/context');
      const data = await res.json();
      document.getElementById('token-meter').textContent = '⚡ [' + data.tokens + ' / ' + data.ceiling + ' tokens]';
      document.getElementById('token-bar').style.width = Math.min(100, (data.tokens / data.ceiling) * 100) + '%';
    }
    async function loadGraph() {
      const res = await fetch('/api/graph');
      const data = await res.json();
      const list = document.getElementById('graph-list');
      if (!data.nodes || data.nodes.length === 0) {
        list.innerHTML = '<li>No graph.json found yet. The structural knowledge graph appears here once indexed.</li>';
        return;
      }
      list.innerHTML = data.nodes.slice(0, 100).map(function (node) {
        const deps = (node.dependencies || []).join(', ');
        return '<li><span class="type">' + node.type + '</span>' + node.name + (deps ? ' <span style="color:#64748B">→ ' + deps + '</span>' : '') + '</li>';
      }).join('');
    }
    async function loadHistory() {
      const res = await fetch('/api/history');
      const history = await res.json();
      const list = document.getElementById('history-log');
      if (!history || history.length === 0) {
        list.innerHTML = '<li>No checkpoints yet.</li>';
        return;
      }
      list.innerHTML = history.map(function (h) {
        return '<li><span><code>' + h.hash + '</code> ' + h.message + ' <span style="color:#64748B">(' + h.date + ')</span></span>' +
          '<button class="rollback" onclick="rollback(\\'' + h.hash + '\\')">↩ Rollback</button></li>';
      }).join('');
    }
    async function rollback(hash) {
      if (!confirm('Hard reset workspace to checkpoint ' + hash + '? This discards uncommitted changes.')) return;
      const res = await fetch('/api/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: hash })
      });
      const data = await res.json();
      alert(data.ok ? 'Rolled back to ' + hash : 'Rollback failed (invalid hash or git error).');
      loadHistory();
    }
    loadData();
    loadContext();
    loadGraph();
    loadHistory();
    setInterval(loadContext, 5000);
  </script>
</body>
</html>`);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server?.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : this.port;
        console.log(`⚡ [HyperSABMemory :: Dashboard] Server running at http://127.0.0.1:${boundPort}`);
        resolve(boundPort);
      });
    });
  }

  /**
   * Stops the HTTP dashboard server.
   */
  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}