/**
 * HyperMemory — Live Web Dashboard & Local API Server
 * Hosts a zero-latency Web Visualizer at http://localhost:4321
 */

import * as http from 'http';
import { SupermemoryEngine } from '../memory/supermemory.js';
import { GraphifyEngine } from '../memory/graphify.js';
import { AutoCommitEngine } from '../hooks/autoCommit.js';
import { HybridSearchEngine } from '../memory/hybridSearch.js';

export class DashboardServer {
  private port: number;
  private workspaceDir: string;
  private server: http.Server | null = null;
  private supermemory: SupermemoryEngine;
  private graphify: GraphifyEngine;
  private autoCommit: AutoCommitEngine;
  private hybridSearch: HybridSearchEngine;

  constructor(port: number = 4321, workspaceDir: string = process.cwd()) {
    this.port = port;
    this.workspaceDir = workspaceDir;
    this.supermemory = new SupermemoryEngine(workspaceDir);
    this.graphify = new GraphifyEngine(workspaceDir);
    this.autoCommit = new AutoCommitEngine({
      workspaceDir
    });
    this.hybridSearch = new HybridSearchEngine(workspaceDir);
  }

  /**
   * Starts the HTTP dashboard server.
   */
  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${this.port}`);

        // CORS Headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

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
            graphify: this.graphify.getGraphSummary(),
            supermemory: this.supermemory.getSummary(),
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

        // Endpoint: / (HTML Dashboard)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>⚡ HyperMemory Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0B0F19; color: #E2E8F0; margin: 0; padding: 20px; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1E293B; padding-bottom: 15px; margin-bottom: 20px; }
    .badge { background: #00F0FF; color: #0B0F19; font-weight: bold; padding: 4px 10px; border-radius: 12px; font-size: 12px; }
    .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .card { background: #161C2E; border: 1px solid #1E293B; border-radius: 8px; padding: 20px; }
    .card h3 { color: #00F0FF; margin-top: 0; }
    pre { background: #0F172A; padding: 12px; border-radius: 6px; overflow-x: auto; color: #38BDF8; font-size: 13px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>⚡ HyperMemory Live Dashboard</h1>
    <span class="badge">SYSTEM ONLINE</span>
  </div>
  <div class="card-grid">
    <div class="card">
      <h3>🕸️ Graphify Structural Graph</h3>
      <p id="graphify-status">Loading Graphify AST Nodes...</p>
    </div>
    <div class="card">
      <h3>🧠 Supermemory Persistent Base</h3>
      <p id="supermemory-status">Loading Supermemory Log...</p>
    </div>
    <div class="card">
      <h3>🕒 Git Auto-Commit Timeline</h3>
      <pre id="history-log">Fetching git checkpoints...</pre>
    </div>
  </div>
  <script>
    async function loadData() {
      const res = await fetch('/api/status');
      const data = await res.json();
      document.getElementById('graphify-status').textContent = data.graphify;
      document.getElementById('supermemory-status').textContent = data.supermemory;

      const histRes = await fetch('/api/history');
      const history = await histRes.json();
      document.getElementById('history-log').textContent = history.map(h => \`[\${h.hash}] \${h.message}\`).join('\\n');
    }
    loadData();
  </script>
</body>
</html>`);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`⚡ [HyperMemory :: Dashboard] Server running at http://127.0.0.1:${this.port}`);
        resolve();
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
