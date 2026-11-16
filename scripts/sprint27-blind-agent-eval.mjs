import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Synthetic and agent-authored; no independent human review.
const sources = {
  'src/invoices/renewal.ts': `export function renewInvoice(invoice) { return { ...invoice, status: 'pending', retryCount: 0 }; }\n`,
  'tests/invoices/renewal.test.ts': `it('clears retries', () => expect(renewInvoice({ retryCount: 3 }).retryCount).toBe(0));\n`,
  'src/http/invoiceRoutes.ts': `router.post('/invoices/:id/renew', requireBillingAdmin, renewInvoiceHandler);\n`,
  'docs/billing.md': `Billing admins can renew an invoice, returning it to pending and clearing retries.\n`,
  'src/uploads/expiry.ts': `export const UPLOAD_EXPIRY_MINUTES = 45;\nexport function expiresAt(now) { return now + UPLOAD_EXPIRY_MINUTES * 60000; }\n`,
  'tests/uploads/expiry.test.ts': `it('expires after 45 minutes', () => expect(expiresAt(0)).toBe(2700000));\n`,
  'src/http/uploadRoutes.ts': `router.post('/uploads', requireSession, createUpload);\n`,
  'docs/uploads.md': `Authenticated users start uploads; upload tickets expire after 45 minutes.\n`,
  'src/notifications/digest.ts': `export const DIGEST_WINDOW_HOURS = 12;\nexport function scheduleDigest(queue) { return queue.enqueue('digest', DIGEST_WINDOW_HOURS); }\n`,
  'tests/notifications/digest.test.ts': `it('schedules after 12 hours', () => expect(DIGEST_WINDOW_HOURS).toBe(12));\n`,
  'docs/digest-legacy.md': `The digest window is 24 hours. This document has not been reconciled with the scheduler.\n`,
  'docs/operations.md': `Operators can inspect queue depth and restart a stopped worker.\n`,
};
const cases = [
  { id: 'renewal', query: 'Where is invoice renewal implemented and tested, and who may call it?', relevant: ['src/invoices/renewal.ts', 'tests/invoices/renewal.test.ts', 'src/http/invoiceRoutes.ts', 'docs/billing.md'] },
  { id: 'upload', query: 'Trace upload ticket expiry from implementation and test to the HTTP route and user guide.', relevant: ['src/uploads/expiry.ts', 'tests/uploads/expiry.test.ts', 'src/http/uploadRoutes.ts', 'docs/uploads.md'] },
  { id: 'conflict', query: 'What is the digest scheduling window and where do implementation and documentation disagree?', relevant: ['src/notifications/digest.ts', 'tests/notifications/digest.test.ts', 'docs/digest-legacy.md'], conflict: '12 versus 24 hours' },
  { id: 'no-answer', query: 'Which encryption cipher protects uploaded attachments at rest?', relevant: [], expected: 'no evidence in the synthetic corpus' },
  { id: 'stale', query: 'What is the exact value of UPLOAD_EXPIRY_MINUTES?', relevant: ['src/uploads/expiry.ts'], expected: 'changed source must not be presented as current verified evidence', stale: 'src/uploads/expiry.ts' },
];

const tmpRoot = await realpath(os.tmpdir());
const workspace = await mkdtemp(path.join(tmpRoot, 'sprint27-blind-'));
const checkedWorkspace = await realpath(workspace);
function safeTarget(target) {
  const rel = path.relative(tmpRoot, target);
  return Boolean(rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) && path.basename(target).startsWith('sprint27-blind-'));
}
if (!safeTarget(checkedWorkspace)) throw new Error('Refusing unsafe temporary workspace');
let client;
try {
  for (const [name, body] of Object.entries(sources)) {
    const target = path.resolve(checkedWorkspace, name);
    const relative = path.relative(checkedWorkspace, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Refusing source outside temporary workspace');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  const server = path.resolve('dist/cli/index.js');
  client = new Client({ name: 'sprint27-agent-blind-eval', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, 'mcp'], cwd: checkedWorkspace, stderr: 'pipe' }));
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result)}`);
    if (result.structuredContent) return result.structuredContent;
    const text = result.content?.find(item => item.type === 'text')?.text;
    if (!text) throw new Error(`${name} returned no content`);
    try { return JSON.parse(text); } catch { throw new Error(`${name} returned non-JSON content: ${text}`); }
  }
  const created = await call('hypersabmemory_task_create', {
    goal: 'Evaluate evidence for synthetic software maintenance questions',
    constraints: ['Use only supplied synthetic sources'],
    acceptanceCriteria: ['Return evidence for each question'],
    sourceRefs: Object.keys(sources),
  });
  const taskId = created.taskId ?? created.task?.id ?? created.id;
  if (typeof taskId !== 'string' || !taskId) throw new Error(`Cannot identify created task: ${JSON.stringify(created)}`);
  const results = [];
  for (const item of cases) {
    if (item.stale) {
      const target = path.resolve(checkedWorkspace, item.stale);
      const relative = path.relative(checkedWorkspace, target);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Refusing stale mutation outside temporary workspace');
      await writeFile(target, 'export const UPLOAD_EXPIRY_MINUTES = 90;\n');
    }
    const response = await call('hypersabmemory_task_grounded_query', { taskId, query: item.query });
    results.push({ ...item, response });
  }
  console.log(JSON.stringify({ provenance: 'agent-authored synthetic; not human-reviewed', scoring: 'unscored; inspect evidence and claims against labels', results }, null, 2));
} finally {
  if (client) await client.close();
  const current = await realpath(workspace);
  if (current !== checkedWorkspace || !safeTarget(current)) throw new Error('Refusing unsafe temporary cleanup');
  await rm(current, { recursive: true, force: true });
}
