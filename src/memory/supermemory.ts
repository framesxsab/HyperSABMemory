/**
 * HyperMemory — Supermemory Persistent Memory Layer
 * Serves as the persistent reference memory engine, maintaining cross-session state,
 * semantic memory indexing, and live Memory.md context synchronization.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildContextBlock } from './contextBlock.js';
import { SqliteStore, MemoryRecord } from './sqliteStore.js';

export class SupermemoryEngine {
  private store: SqliteStore;
  private memoryFilePath: string;

  constructor(workspaceDir: string = '.') {
    const memoryDir = path.join(workspaceDir, '.hypermemory');
    this.store = new SqliteStore(memoryDir);
    this.memoryFilePath = path.join(workspaceDir, 'Memory.md');
  }

  /**
   * Remembers a new key architectural insight or decision.
   * Duplicate/overlapping active facts are superseded (merge/forget).
   */
  public remember(category: MemoryRecord['category'], content: string, tags: string[] = []): MemoryRecord {
    if (!content || !content.trim()) {
      throw new Error('content must be a non-empty string');
    }
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record = this.store.set({ id, category, content, tags, status: 'active' });

    for (const existing of this.store.getActive()) {
      if (existing.id === record.id) continue;
      if (existing.category !== category) continue;
      if (!this.isDuplicateOrContradiction(existing.content, content)) continue;
      this.store.supersede(existing.id, record.id);
    }

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
      const recordsFormatted = records.map(r => 
        `- **[${r.category.toUpperCase()}]** (${new Date(r.timestamp).toLocaleTimeString()}) [${r.status ?? 'active'}]: ${r.content}`
      ).join('\n');

      let content = fs.readFileSync(this.memoryFilePath, 'utf-8');

      const sectionHeader = '## Persistent Supermemory Index';
      const newSection = `${sectionHeader}\n${recordsFormatted || 'No records logged yet.'}`;

      if (content.includes(sectionHeader)) {
        content = content.replace(new RegExp(`${sectionHeader}[\\s\\S]*?(?=\\n## |$)`), `${newSection}\n\n`);
      } else {
        content += `\n\n${newSection}`;
      }

      fs.writeFileSync(this.memoryFilePath, content, 'utf-8');
    } catch (err) {
      console.error('[HyperMemory :: SupermemoryEngine] Failed to sync Memory.md:', err);
    }
  }
}
