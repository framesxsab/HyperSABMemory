/**
 * HyperSABMemory — Temporal Persistent Memory Layer
 * Serves as the persistent reference memory engine, maintaining cross-session state,
 * semantic memory indexing, and live Memory.md context synchronization.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildContextBlock } from './contextBlock.js';
import { SqliteStore, MemoryRecord, StructuredMemory } from './sqliteStore.js';
import { SEED_TAG } from './seeding.js';

export class TemporalMemoryEngine {
  private store: SqliteStore;
  private memoryFilePath: string;

  constructor(workspaceDir: string = '.') {
    const memoryDir = path.join(workspaceDir, '.hypersabmemory');
    this.store = new SqliteStore(memoryDir, true);
    this.memoryFilePath = path.join(workspaceDir, 'Memory.md');
  }

  /**
   * Remembers a new key architectural insight or decision.
   * Duplicate/overlapping active facts are superseded (merge/forget).
   */
  public remember(
    category: MemoryRecord['category'],
    content: string,
    tags: string[] = [],
    structured?: StructuredMemory
  ): MemoryRecord {
    if (!content || !content.trim()) {
      throw new Error('content must be a non-empty string');
    }
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record = this.store.setAndSupersede({
      id,
      category,
      content,
      tags,
      status: 'active',
      ...(structured?.intent ? { intent: structured.intent } : {}),
      ...(structured?.artifacts?.length ? { artifacts: structured.artifacts } : {}),
      ...(structured?.errorsAndFixes ? { errorsAndFixes: structured.errorsAndFixes } : {}),
      ...(structured?.nextSteps ? { nextSteps: structured.nextSteps } : {})
    }, (existing, incoming) =>
      existing.category === incoming.category &&
      !(existing.tags ?? []).includes(SEED_TAG) &&
      this.isDuplicateOrContradiction(existing.content, incoming.content)
    );

    this.syncToMemoryFile();
    return record;
  }

  public forget(id: string): MemoryRecord | undefined {
    const forgotten = this.store.forget(id);
    if (forgotten) this.syncToMemoryFile();
    return forgotten;
  }

  /**
   * Searches persistent memory records by query (active facts only).
   */
  public query(searchTerm: string, limit: number = 25): MemoryRecord[] {
    return this.store.search(searchTerm)
      .filter((record) => (record.status ?? 'active') === 'active')
      .slice(0, limit);
  }

  /**
   * Returns all active memory records (unranked) for corpus-level scoring.
   */
  public getActive(): MemoryRecord[] {
    return this.store.getActive();
  }

  /**
   * Returns a concise summary of persistent memory for agent context headers.
   */
  public getSummary(): string {
    const all = this.store.getActive();
    if (all.length === 0) return 'No stored memories yet.';

    const latest = all.slice(-3).map(m => `[${m.category}] ${m.content}`).join(' | ');
    return `${all.length} items recorded. Latest: ${latest}`;
  }

  /** Newest-first ledger rows for the dashboard memory pane. */
  public getLedger(limit = 4): Array<{ date: string; tag: string; text: string }> {
    return this.store.getActive().slice(-50).reverse().slice(0, limit).map(r => ({
      date: r.timestamp.slice(0, 10),
      tag: r.category,
      text: r.content
    }));
  }

  /** Total vs active record counts for the dashboard stats strip. */
  public getCounts(): { recorded: number; active: number } {
    const all = this.store.getAll();
    return {
      recorded: all.length,
      active: all.filter(r => (r.status ?? 'active') === 'active').length
    };
  }

  public getContextBlock(): string {
    return buildContextBlock(this.store.getActive(), this.getSummary());
  }

  private isDuplicateOrContradiction(existing: string, incoming: string): boolean {
    const a = existing.toLowerCase().replace(/\s+/g, ' ').trim();
    const b = incoming.toLowerCase().replace(/\s+/g, ' ').trim();
    if (a === b) return true;
    const prefixLen = Math.min(48, b.length, a.length);
    if (prefixLen < 16) return false;
    return a.includes(b.slice(0, prefixLen)) || b.includes(a.slice(0, prefixLen));
  }

  /**
   * Synchronizes current active memory state to project Memory.md file.
   */
  public syncToMemoryFile(): void {
    if (!fs.existsSync(this.memoryFilePath)) {
      return;
    }

    try {
      const records = this.store.getAll();
      const recordsFormatted = records.map(r => {
        const lines = [
          `- **[${r.category.toUpperCase()}]** (${new Date(r.timestamp).toLocaleTimeString()}) [${r.status ?? 'active'}]: ${r.content}`
        ];
        if (r.intent) lines.push(`  - intent: ${r.intent}`);
        if (r.artifacts?.length) lines.push(`  - artifacts: ${r.artifacts.join(', ')}`);
        if (r.errorsAndFixes) lines.push(`  - fix: ${r.errorsAndFixes}`);
        if (r.nextSteps) lines.push(`  - next: ${r.nextSteps}`);
        return lines.join('\n');
      }).join('\n');

      let content = fs.readFileSync(this.memoryFilePath, 'utf-8');

      const sectionHeader = '## Persistent Memory Index';
      const newSection = `${sectionHeader}\n${recordsFormatted || 'No records logged yet.'}`;

      if (content.includes(sectionHeader)) {
        content = content.replace(new RegExp(`${sectionHeader}[\\s\\S]*?(?=\\n## |$)`), `${newSection}\n\n`);
      } else {
        content += `\n\n${newSection}`;
      }

      fs.writeFileSync(this.memoryFilePath, content, 'utf-8');
    } catch (err) {
      console.error('[HyperSABMemory :: TemporalMemoryEngine] Failed to sync Memory.md:', err);
    }
  }
}
