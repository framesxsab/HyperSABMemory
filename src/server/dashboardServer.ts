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
            records: this.memory.getLedger(24),
            counts: this.memory.getCounts(),
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
  <title>HyperSABMemory — dashboard</title>
  <style>
    :root {
      --bg: #0a0e16;
      --hairline: #1c2333;
      --fg-hi: #dce3f0;
      --fg: #9aa5ba;
      --fg-dim: #5c6880;
      --fg-faint: #3a4560;
      --accent: #ffb454;
      --accent-dim: rgba(255,180,84,0.12);
      --mono: "JetBrains Mono","SF Mono","Cascadia Code",Consolas,monospace;
    }
    * { box-sizing: border-box; }
    html, body { background: var(--bg); }
    body {
      font-family: var(--mono);
      color: var(--fg);
      font-size: 13px;
      line-height: 1.55;
      margin: 0;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    ::selection { background: var(--accent-dim); color: var(--fg-hi); }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--hairline); border-radius: 2px; }

    /* ── titlebar ─────────────────────────────────────────── */
    .header {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--hairline);
    }
    .wordmark { color: var(--fg-hi); font-size: 13px; letter-spacing: 0.02em; }
    .cursor {
      color: var(--accent);
      animation: blink 1.06s steps(1) infinite;
      margin-left: 2px;
    }
    @keyframes blink { 50% { opacity: 0; } }
    .badge {
      background: none; color: var(--fg-dim);
      font-weight: normal; font-size: 11px;
      padding: 0; border-radius: 0;
      text-transform: lowercase; letter-spacing: 0.04em;
    }

    /* ── canvas: one bordered surface, hairline-split panes ─ */
    .card-grid {
      display: grid;
      grid-template-columns: 5fr 7fr;
      grid-template-rows: auto auto;
      gap: 1px;
      background: var(--hairline);
      border-bottom: 1px solid var(--hairline);
      min-height: calc(100vh - 42px);
    }
    .card {
      background: var(--bg);
      border: none; border-radius: 0;
      padding: 14px 16px 16px;
      min-width: 0;
    }
    .card h3 {
      color: var(--fg-dim);
      margin: 0 0 10px;
      font-size: 10px; font-weight: 500;
      text-transform: uppercase; letter-spacing: 0.14em;
    }
    .pane-head {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 12px; margin-bottom: 10px;
    }
    .pane-label, .card h3 {
      color: var(--fg-dim);
      font-size: 10px; font-weight: 500;
      text-transform: uppercase; letter-spacing: 0.14em;
    }
    .pane-meta { color: var(--fg-faint); font-size: 11px; white-space: nowrap; }
    .pane-status { color: var(--fg-dim); font-size: 12px; margin: 0 0 10px; }

    /* ── token meter: segmented cells ─────────────────────── */
    .meter-wrap {
      display: flex; gap: 2px;
      background: transparent; border-radius: 0;
      height: 18px; overflow: hidden;
      margin-top: 8px;
    }
    .meter-cell {
      flex: 1 1 0;
      background: var(--hairline);
      border-radius: 2px;
      transition: background 0.25s ease;
    }
    .meter-cell.on { background: var(--accent); }
    .meter-cell.hot { background: #ff6b54; }
    .meter-legend {
      display: flex; justify-content: space-between;
      margin-top: 6px;
      color: var(--fg-faint); font-size: 11px;
    }
    .meter-readout { color: var(--fg-hi); font-size: 12px; margin: 0; }
    .meter-readout b { color: var(--accent); font-weight: 600; }

    /* ── token sparkline (real client-side samples) ──────── */
    .spark { margin-top: 18px; }
    .spark-head {
      display: flex; justify-content: space-between; align-items: baseline;
      color: var(--fg-dim); font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.12em;
      margin-bottom: 6px;
    }
    .spark-row {
      display: flex; justify-content: space-between; align-items: flex-end;
      font-size: 19px; line-height: 1;
      color: var(--fg-faint);
    }
    .spark-row i { font-style: normal; }
    .spark-row i.hi { color: var(--accent); }

    /* ── live header preview ─────────────────────────────── */
    .header-preview {
      margin: 16px 0 0;
      padding: 12px 14px;
      border: 1px solid var(--hairline);
      color: var(--fg-dim);
      font-family: var(--mono);
      font-size: 11px;
      line-height: 1.6;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 240px;
      overflow-y: auto;
    }

    /* ── memory ledger ────────────────────────────────────── */
    .ledger { list-style: none; padding: 0; margin: 0; max-height: 260px; overflow-y: auto; }
    .ledger li {
      display: flex; gap: 10px;
      padding: 5px 0;
      border-bottom: 1px solid rgba(28,35,51,0.55);
      font-size: 12px;
    }
    .ledger li:last-child { border-bottom: none; }
    .ledger .date { color: var(--fg-faint); white-space: nowrap; flex-shrink: 0; }
    .ledger .cat { color: var(--accent); white-space: nowrap; flex-shrink: 0; }
    .ledger .fact { color: var(--fg); min-width: 0; overflow-wrap: break-word; }

    /* ── graph tree ───────────────────────────────────────── */
    .graph-list { list-style: none; padding: 0; margin: 0; max-height: 300px; overflow-y: auto; }
    .graph-list li {
      padding: 3px 0;
      border-bottom: none;
      font-size: 12.5px;
      color: var(--fg-hi);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .graph-list .glyph { color: var(--fg-faint); margin-right: 6px; }
    .graph-list .type {
      color: var(--fg-dim); font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.08em;
      margin-right: 8px;
    }
    .graph-list .deps { color: var(--fg-dim); }
    .graph-list li.more { color: var(--fg-dim); font-size: 11px; }

    /* ── checkpoint timeline ──────────────────────────────── */
    .history-list { list-style: none; padding: 0; margin: 0; max-height: 300px; overflow-y: auto; position: relative; }
    .history-list li {
      display: flex; align-items: center; gap: 10px;
      padding: 5px 0 5px 18px;
      border-bottom: none;
      font-size: 12px;
      position: relative;
    }
    .history-list li::before {
      content: ""; position: absolute; left: 4px; top: 0; bottom: 0;
      width: 1px; background: var(--hairline);
    }
    .history-list li::after {
      content: ""; position: absolute; left: 1.5px; top: 50%;
      width: 7px; height: 7px; transform: translateY(-50%);
      background: var(--bg);
      border: 1px solid var(--fg-faint);
      border-radius: 2px;
    }
    .history-list li:first-child::after { border-color: var(--accent); background: var(--accent); }
    .history-list .hash {
      color: var(--accent); background: var(--accent-dim);
      border-radius: 2px; padding: 0 4px;
      font-size: 11px; flex-shrink: 0;
    }
    .history-list .msg { color: var(--fg); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .history-list .date { color: var(--fg-faint); font-size: 11px; white-space: nowrap; margin-left: auto; flex-shrink: 0; }
    .history-list code { color: var(--fg-dim); }

    /* ── ghost rollback button ────────────────────────────── */
    button.rollback {
      background: transparent; color: var(--fg-dim);
      border: 1px solid var(--hairline); border-radius: 2px;
      padding: 1px 7px; font-family: var(--mono);
      font-size: 10px; cursor: pointer;
      flex-shrink: 0;
      transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    }
    button.rollback:hover {
      background: var(--accent-dim); color: var(--accent); border-color: var(--accent);
    }

    .empty { color: var(--fg-faint); font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div><span class="wordmark">HyperSABMemory</span><span class="cursor">▮</span></div>
    <span class="badge">local · no telemetry</span>
  </div>
  <main class="card-grid">
    <section class="card">
      <div class="pane-head">
        <span class="pane-label">Context Harness</span>
        <span class="pane-meta" id="token-meter">syncing…</span>
      </div>
      <p class="meter-readout" id="token-readout">&nbsp;</p>
      <div class="meter-wrap" id="token-bar"></div>
      <div class="meter-legend"><span>0</span><span class="meter-ceiling">1500 tok</span></div>
      <div class="spark" id="spark" hidden>
        <div class="spark-head"><span>token load &middot; last 24 refreshes</span><span id="spark-stats"></span></div>
        <div class="spark-row" id="spark-row"></div>
      </div>
      <pre class="header-preview" id="header-preview" hidden></pre>
    </section>
    <section class="card">
      <div class="pane-head">
        <span class="pane-label">Structural Graph</span>
        <span class="pane-meta" id="graph-status">syncing…</span>
      </div>
      <ul class="graph-list" id="graph-list"></ul>
    </section>
    <section class="card">
      <div class="pane-head">
        <span class="pane-label">Memory Store</span>
        <span class="pane-meta" id="memory-count"></span>
      </div>
      <p class="pane-status" id="memory-status">syncing…</p>
      <ul class="ledger" id="memory-log"></ul>
    </section>
    <section class="card">
      <div class="pane-head">
        <span class="pane-label">Checkpoint Timeline</span>
        <span class="pane-meta">git · local only</span>
      </div>
      <ul class="history-list" id="history-log"><li class="empty">fetching checkpoints…</li></ul>
    </section>
  </main>
  <script>
    var METER_CELLS = 20;
    var bar = document.getElementById('token-bar');
    for (var _i = 0; _i < METER_CELLS; _i++) {
      var _c = document.createElement('i');
      _c.className = 'meter-cell';
      bar.appendChild(_c);
    }
    var tokenSamples = [];
    var SPARK_GLYPHS = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587'];
    function renderSpark() {
      const spark = document.getElementById('spark');
      if (tokenSamples.length < 3) { spark.hidden = true; return; }
      spark.hidden = false;
      const min = Math.min.apply(null, tokenSamples);
      const max = Math.max.apply(null, tokenSamples);
      const span = Math.max(1, max - min);
      const sorted = tokenSamples.slice().sort(function (a, b) { return a - b; });
      const p50 = sorted[Math.floor((sorted.length - 1) / 2)];
      const p95 = sorted[Math.ceil((sorted.length - 1) * 0.95)];
      document.getElementById('spark-stats').textContent = 'p50 ' + p50 + ' \u00b7 p95 ' + p95;
      document.getElementById('spark-row').innerHTML = tokenSamples.map(function (v, i) {
        const level = Math.min(6, Math.floor(((v - min) / span) * 7));
        return '<i' + (i === tokenSamples.length - 1 ? ' class="hi"' : '') + '>' + SPARK_GLYPHS[level] + '</i>';
      }).join('');
    }
    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    async function loadData() {
      const res = await fetch('/api/status');
      const data = await res.json();
      document.getElementById('graph-status').textContent = data.graph;
      document.getElementById('memory-status').textContent = data.memory;
      document.getElementById('memory-count').textContent = (data.counts ? data.counts.recorded : 0) + ' recorded';
      const log = document.getElementById('memory-log');
      log.innerHTML = (data.records || []).map(function (r) {
        return '<li><span class="date">' + esc(r.date) + '</span><span class="cat">[' + esc(r.tag) + ']</span><span class="fact">' + esc(r.text) + '</span></li>';
      }).join('');
    }    async function loadContext() {
      const res = await fetch('/api/context');
      const data = await res.json();
      document.getElementById('token-meter').textContent = data.tokens + ' / ' + data.ceiling + ' tok';
      document.getElementById('token-readout').innerHTML = '<b>' + data.tokens + '</b> / ' + data.ceiling;
      const lit = Math.round((data.tokens / data.ceiling) * METER_CELLS);
      bar.querySelectorAll('.meter-cell').forEach(function (c, i) {
        c.classList.toggle('on', i < lit);
      });
      tokenSamples.push(data.tokens);
      if (tokenSamples.length > 24) tokenSamples.shift();
      renderSpark();
      const hp = document.getElementById('header-preview');
      if (data.header) {
        hp.hidden = false;
        hp.textContent = data.header;
      } else {
        hp.hidden = true;
      }
    }
    async function loadGraph() {
      const res = await fetch('/api/graph');
      const data = await res.json();
      const list = document.getElementById('graph-list');
      if (!data.nodes || data.nodes.length === 0) {
        list.innerHTML = '<li class="empty">No graph.json found yet. The structural knowledge graph appears here once indexed.</li>';
        return;
      }
      list.innerHTML = data.nodes.map(function (node) {
        const deps = (node.dependencies || []).join(', ');
        return '<li><span class="type">' + esc(node.type) + '</span>' + esc(node.name) + (deps ? ' <span class="deps">→ ' + esc(deps) + '</span>' : '') + '</li>';
      }).join('') + (data.nodes.length > 24 ? '<li class="more">+' + (data.nodes.length - 24) + ' more indexed</li>' : '');
    }
    async function loadHistory() {
      const res = await fetch('/api/history');
      const history = await res.json();
      const list = document.getElementById('history-log');
      if (!history || history.length === 0) {
        list.innerHTML = '<li class="empty">No checkpoints yet.</li>';
        return;
      }
      list.innerHTML = history.slice(0, 7).map(function (h) {
        return '<li><code>' + esc(h.hash) + '</code><span class="msg">' + esc(h.message) + '</span><span class="date">' + esc(h.date) + '</span>' +
          '<button class="rollback" onclick="rollback(\\'' + h.hash + '\\')">rollback</button></li>';
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
        console.log(`[HyperSABMemory :: Dashboard] Server running at http://127.0.0.1:${boundPort}`);
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