/**
 * HyperSABMemory — Local Memory Store (Temporal Memory Base)
 * Fast, lightweight key-value & document memory storage for AI agent state persistence.
 */

import * as fs from 'fs';
import * as path from 'path';
import { withFileLock, writeAtomicText } from './fileLock.js';

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
  source?: 'seed' | 'auto' | 'user';
}

export class SqliteStore {
  private storagePath: string;
  private memoryMap: Map<string, MemoryRecord> = new Map();
  private loadedFile?: string;
  private loadedContents?: string;
  private failedTemporaryContents?: string;
  private initialized = false;

  constructor(baseDir: string = '.hypersabmemory', deferLoad = false) {
    this.storagePath = path.join(baseDir, 'memory_store.json');
    this.ensureStorageDir(baseDir);
    if (!deferLoad) this.loadStore();
  }

  private ensureStorageDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private get lockPath(): string {
    return `${this.storagePath}.lock`;
  }

  private loadStore(warnWhenMissing: boolean = true): void {
    warnWhenMissing ||= !this.initialized;
    this.initialized = true;
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

    this.memoryMap.clear();
    this.loadedFile = undefined;
    this.loadedContents = undefined;
    if (warnWhenMissing) {
      console.warn('[HyperSABMemory :: SqliteStore] No readable memory store found — starting clean.');
    }
  }

  private tryLoadFrom(file: string): boolean {
    try {
      if (!fs.existsSync(file)) return false;
      const raw = fs.readFileSync(file, 'utf-8');
      if (file === `${this.storagePath}.tmp` && raw === this.failedTemporaryContents) return false;
      if (file === this.loadedFile && raw === this.loadedContents) return true;
      const data: MemoryRecord[] = JSON.parse(raw);
      if (!Array.isArray(data)) return false;
      this.memoryMap.clear();
      data.forEach(record => this.memoryMap.set(record.id, record));
      this.loadedFile = file;
      this.loadedContents = raw;
      return true;
    } catch {
      return false;
    }
  }

  private writeRecords(records: Iterable<MemoryRecord>): void {
    let payload: string | undefined;
    try {
      const arrayData = Array.from(records);
      payload = JSON.stringify(arrayData, null, 2);
      writeAtomicText(this.storagePath, payload);
      this.failedTemporaryContents = undefined;
      this.loadedFile = undefined;
      this.loadedContents = undefined;

      try {
        fs.copyFileSync(this.storagePath, `${this.storagePath}.bak`);
      } catch {
        // Mirror failure is non-fatal.
      }
    } catch (err) {
      this.failedTemporaryContents = payload;
      console.error('[HyperSABMemory :: SqliteStore] Failed to write memory store:', err);
      throw err;
    }
  }

  public saveStore(): void {
    withFileLock(this.lockPath, () => {
      if (!this.initialized) this.loadStore();
      this.writeRecords(this.memoryMap.values());
    });
  }

  public set(record: Omit<MemoryRecord, 'timestamp'> & { timestamp?: string }): MemoryRecord {
    return withFileLock(this.lockPath, () => {
      this.loadStore(false);
      return this.applySetUnderLock(record);
    });
  }

  private applySetUnderLock(record: Omit<MemoryRecord, 'timestamp'> & { timestamp?: string }): MemoryRecord {
    const fullRecord: MemoryRecord = {
      ...record,
      status: record.status ?? 'active',
      timestamp: record.timestamp ?? new Date().toISOString()
    };
    const nextRecords = new Map(this.memoryMap);
    nextRecords.set(fullRecord.id, fullRecord);
    this.writeRecords(nextRecords.values());
    this.memoryMap = nextRecords;
    return fullRecord;
  }

  /** Persist a new fact and all matching supersedes as one locked JSON-store update. */
  public setAndSupersede(
    record: Omit<MemoryRecord, 'timestamp'> & { timestamp?: string },
    shouldSupersede: (existing: MemoryRecord, incoming: MemoryRecord) => boolean
  ): MemoryRecord {
    return withFileLock(this.lockPath, () => {
      this.loadStore(false);
      const incoming: MemoryRecord = {
        ...record,
        status: record.status ?? 'active',
        timestamp: record.timestamp ?? new Date().toISOString()
      };
      const nextRecords = new Map(this.memoryMap);
      nextRecords.set(incoming.id, incoming);
      const invalidAt = new Date().toISOString();

      for (const existing of this.memoryMap.values()) {
        if (
          existing.id === incoming.id ||
          (existing.status ?? 'active') !== 'active' ||
          !shouldSupersede(existing, incoming)
        ) continue;

        nextRecords.set(existing.id, {
          ...existing,
          status: 'superseded',
          invalidAt,
          tags: [...(existing.tags ?? []), `superseded-by:${incoming.id}`]
        });
      }

      this.writeRecords(nextRecords.values());
      this.memoryMap = nextRecords;
      return incoming;
    });
  }

  public get(id: string): MemoryRecord | undefined {
    this.loadStore(false);
    return this.memoryMap.get(id);
  }

  public search(query: string): MemoryRecord[] {
    const q = query.toLowerCase();
    return this.getAll().filter(record =>
      record.content.toLowerCase().includes(q) ||
      record.category.toLowerCase().includes(q) ||
      record.tags?.some(t => t.toLowerCase().includes(q))
    );
  }

  public getAll(): MemoryRecord[] {
    this.loadStore(false);
    return Array.from(this.memoryMap.values());
  }

  public getActive(): MemoryRecord[] {
    return this.getAll().filter((record) => (record.status ?? 'active') === 'active');
  }

  public forget(id: string): MemoryRecord | undefined {
    return withFileLock(this.lockPath, () => {
      this.loadStore(false);
      const existing = this.memoryMap.get(id);
      if (!existing) return undefined;
      return this.applySetUnderLock({
        ...existing,
        status: 'forgotten',
        invalidAt: new Date().toISOString()
      });
    });
  }

  public supersede(id: string, successorId: string): MemoryRecord | undefined {
    return withFileLock(this.lockPath, () => {
      this.loadStore(false);
      const existing = this.memoryMap.get(id);
      if (!existing) return undefined;
      return this.applySetUnderLock({
        ...existing,
        status: 'superseded',
        invalidAt: new Date().toISOString(),
        tags: [...(existing.tags ?? []), `superseded-by:${successorId}`]
      });
    });
  }

  public clear(): void {
    withFileLock(this.lockPath, () => {
      this.loadStore(false);
      this.writeRecords([]);
      this.memoryMap = new Map();
    });
  }
}
