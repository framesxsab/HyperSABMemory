/**
 * HyperMemory — Supermemory Persistent Memory Layer
 * Serves as the persistent reference memory engine, maintaining cross-session state,
 * semantic memory indexing, and live Memory.md context synchronization.
 */

import * as fs from 'fs';
import * as path from 'path';
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
   */
  public remember(category: MemoryRecord['category'], content: string, tags: string[] = []): MemoryRecord {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record = this.store.set({ id, category, content, tags });
    this.syncToMemoryFile();
    return record;
  }

  /**
   * Searches persistent memory records by query.
   */
  public query(searchTerm: string): MemoryRecord[] {
    return this.store.search(searchTerm);
  }

  /**
   * Returns a concise summary of persistent memory for agent context headers.
   */
  public getSummary(): string {
    const all = this.store.getAll();
    if (all.length === 0) return 'No stored memories yet.';

    const latest = all.slice(-3).map(m => `[${m.category}] ${m.content}`).join(' | ');
    return `${all.length} items recorded. Latest: ${latest}`;
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
        `- **[${r.category.toUpperCase()}]** (${new Date(r.timestamp).toLocaleTimeString()}): ${r.content}`
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
