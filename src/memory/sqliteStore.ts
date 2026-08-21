/**
 * HyperSABMemory — Local Memory Store (Temporal Memory Base)
 * Fast, lightweight key-value & document memory storage for AI agent state persistence.
 */

import * as fs from 'fs';
import * as path from 'path';

export type MemoryStatus = 'active' | 'forgotten' | 'superseded';

export interface StructuredMemory {
  intent?: string;
  artifacts?: string[];
  errorsAndFixes?: string;
  nextSteps?: string;
}

export interface MemoryRecord extends StructuredMemory {
  id: string;
  category: 'architecture' | 'decision' | 'bug' | 'symbol' | 'general';
  content: string;
  timestamp: string;
  tags?: string[];
  status?: MemoryStatus;
  invalidAt?: string;
  supersedes?: string;
}

export class SqliteStore {
  private storagePath: string;
  private memoryMap: Map<string, MemoryRecord> = new Map();

  constructor(baseDir: string = '.hypersabmemory') {
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
    const tmpPath = `${this.storagePath}.tmp`;
    const bakPath = `${this.storagePath}.bak`;

    // 1) Primary store
    if (this.tryLoadFrom(this.storagePath)) return;

    // 2) Interrupted atomic write (.tmp holds a complete payload only if the
    //    process died between write and rename; partial writes fail JSON.parse)
    if (this.tryLoadFrom(tmpPath)) {
      console.warn(`[HyperSABMemory :: SqliteStore] Primary store unreadable — recovered from ${tmpPath}`);
      return;
    }

    // 3) Post-save mirror of the last known-good state
    if (this.tryLoadFrom(bakPath)) {
      console.warn(`[HyperSABMemory :: SqliteStore] Primary store unreadable — recovered from ${bakPath}`);
      return;
    }

    console.warn('[HyperSABMemory :: SqliteStore] No readable memory store found — starting clean.');
    this.memoryMap.clear();
  }

  private tryLoadFrom(file: string): boolean {
    try {
      if (!fs.existsSync(file)) return false;
      const raw = fs.readFileSync(file, 'utf-8');
      const data: MemoryRecord[] = JSON.parse(raw);
      if (!Array.isArray(data)) return false;
      this.memoryMap.clear();
      data.forEach(record => this.memoryMap.set(record.id, record));
      return true;
    } catch {
      return false;
    }
  }

  public saveStore(): void {
    try {
      const arrayData = Array.from(this.memoryMap.values());
      const payload = JSON.stringify(arrayData, null, 2);
      const tmpPath = `${this.storagePath}.tmp`;

      fs.writeFileSync(tmpPath, payload, 'utf-8');
      try {
        try {
          fs.renameSync(tmpPath, this.storagePath);
        } catch (renameErr) {
          const code = (renameErr as NodeJS.ErrnoException).code;
          if (code === 'EPERM' || code === 'EBUSY') {
            fs.renameSync(tmpPath, this.storagePath); // single retry (Win AV locks)
          } else {
            throw renameErr;
          }
        }
      } catch {
        // Non-atomic fallback rather than losing the save entirely.
        fs.writeFileSync(this.storagePath, payload, 'utf-8');
        console.warn('[HyperSABMemory :: SqliteStore] Atomic rename failed — wrote store directly.');
      }

      try {
        fs.copyFileSync(this.storagePath, `${this.storagePath}.bak`);
      } catch {
        // Mirror failure is non-fatal.
      }
    } catch (err) {
      console.error('[HyperSABMemory :: SqliteStore] Failed to write memory store:', err);
    }
  }

  public set(record: Omit<MemoryRecord, 'timestamp'> & { timestamp?: string }): MemoryRecord {
    const fullRecord: MemoryRecord = {
      ...record,
      status: record.status ?? 'active',
      timestamp: record.timestamp ?? new Date().toISOString()
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

  public getActive(): MemoryRecord[] {
    return this.getAll().filter((record) => (record.status ?? 'active') === 'active');
  }

  public forget(id: string): MemoryRecord | undefined {
    const existing = this.memoryMap.get(id);
    if (!existing) return undefined;
    return this.set({
      ...existing,
      status: 'forgotten',
      invalidAt: new Date().toISOString()
    });
  }

  public supersede(id: string, successorId: string): MemoryRecord | undefined {
    const existing = this.memoryMap.get(id);
    if (!existing) return undefined;
    return this.set({
      ...existing,
      status: 'superseded',
      invalidAt: new Date().toISOString(),
      tags: [...(existing.tags ?? []), `superseded-by:${successorId}`]
    });
  }

  public clear(): void {
    this.memoryMap.clear();
    this.saveStore();
  }
}
