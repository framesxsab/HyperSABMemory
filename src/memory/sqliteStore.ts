/**
 * HyperMemory — Local Memory Store (Supermemory Base)
 * Fast, lightweight key-value & document memory storage for AI agent state persistence.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface MemoryRecord {
  id: string;
  category: 'architecture' | 'decision' | 'bug' | 'symbol' | 'general';
  content: string;
  timestamp: string;
  tags?: string[];
}

export class SqliteStore {
  private storagePath: string;
  private memoryMap: Map<string, MemoryRecord> = new Map();

  constructor(baseDir: string = '.hypermemory') {
    this.storagePath = path.join(baseDir, 'memory_store.json');
    this.ensureStorageDir(baseDir);
    this.loadStore();
  }

  private ensureStorageDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadStore(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf-8');
        const data: MemoryRecord[] = JSON.parse(raw);
        data.forEach(record => this.memoryMap.set(record.id, record));
      }
    } catch {
      // Fallback on clean memory map on parse error
      this.memoryMap.clear();
    }
  }

  public saveStore(): void {
    try {
      const arrayData = Array.from(this.memoryMap.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(arrayData, null, 2), 'utf-8');
    } catch (err) {
      console.error('[HyperMemory :: SqliteStore] Failed to write memory store:', err);
    }
  }

  public set(record: Omit<MemoryRecord, 'timestamp'>): MemoryRecord {
    const fullRecord: MemoryRecord = {
      ...record,
      timestamp: new Date().toISOString()
    };
    this.memoryMap.set(fullRecord.id, fullRecord);
    this.saveStore();
    return fullRecord;
  }

  public get(id: string): MemoryRecord | undefined {
    return this.memoryMap.get(id);
  }

  public search(query: string): MemoryRecord[] {
    const q = query.toLowerCase();
    return Array.from(this.memoryMap.values()).filter(record => 
      record.content.toLowerCase().includes(q) ||
      record.category.toLowerCase().includes(q) ||
      record.tags?.some(t => t.toLowerCase().includes(q))
    );
  }

  public getAll(): MemoryRecord[] {
    return Array.from(this.memoryMap.values());
  }

  public clear(): void {
    this.memoryMap.clear();
    this.saveStore();
  }
}
