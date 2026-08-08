/**
 * HyperMemory — Open-Source IDE Context Harness & Persistent Memory Engine
 * Export entry point for programmatic usage as an NPM library or IDE extension backend.
 */

export { OhMyPiHarness, type HarnessState } from './harness/ohMyPi.js';
export { TokenCompressor, type CompressionOptions } from './harness/tokenCompressor.js';
export { HashAnchorEngine, type HashAnchor } from './harness/hashAnchor.js';
export { PonytailEngine, type PonytailOptions } from './harness/ponytail.js';
export { SupermemoryEngine } from './memory/supermemory.js';
export { GraphifyEngine, type GraphifyData, type GraphNode } from './memory/graphify.js';
export { SqliteStore, type MemoryRecord } from './memory/sqliteStore.js';
export { FileWatcherHook, type FileWatcherOptions } from './hooks/fileWatcher.js';
export { AutoCommitEngine, type AutoCommitOptions } from './hooks/autoCommit.js';
export { OneShotSetupEngine } from './cli/oneShotSetup.js';
export { HyperMemoryMcpServer } from './mcp/server.js';
