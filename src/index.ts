/**
 * HyperSABMemory — Open-Source IDE Context Harness & Persistent Memory Engine
 * Export entry point for programmatic usage as an NPM library or IDE extension backend.
 */

export { ContextHarness, type HarnessState } from './harness/contextHarness.js';
export { TokenCompressor, type CompressionOptions } from './harness/tokenCompressor.js';
export { HashAnchorEngine, type HashAnchor } from './harness/hashAnchor.js';
export { MinimalChangeEngine, type MinimalChangeOptions, type MinimalChangeIntensity } from './harness/minimalChange.js';
export { TemporalMemoryEngine } from './memory/temporalMemory.js';
export { buildContextBlock } from './memory/contextBlock.js';
export { StructuralGraphEngine, type StructuralGraphData, type GraphNode } from './memory/structuralGraph.js';
export { SqliteStore, type MemoryRecord, type MemoryStatus } from './memory/sqliteStore.js';
export { FileWatcherHook, type FileWatcherOptions } from './hooks/fileWatcher.js';
export { AutoCommitEngine, type AutoCommitOptions } from './hooks/autoCommit.js';
export { OneShotSetupEngine } from './cli/oneShotSetup.js';
export { HyperSABMemoryMcpServer } from './mcp/server.js';
export { MEMORYBENCH_FIXTURE, RECALL_THRESHOLD, scoreMemoryBench, seedMemoryBench, evaluateMemoryEngine, type MemoryBenchCase, type MemoryBenchReport } from './eval/memoryBench.js';
export { McpAccessEngine, resolveMcpLaunch, MCP_TOOL_FLOW, type McpHost, type McpLaunch, type McpConnectResult } from './harness/mcpAccess.js';
export { UniversalAdaptersEngine, injectHypersabmemorySection, type NativeRuleKind, type NativeRuleFile, type AdapterSyncOptions, type AdapterSyncResult } from './harness/universalAdapters.js';
