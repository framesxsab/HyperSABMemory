// Independently source-reviewed judgments; revise only after documenting evidence-label errors.
export interface RepositoryTaskCase {
  query: string;
  relevantPaths: string[];
}

// Each task identifies a distinct investigation and its proposed supporting files.
export const HELD_OUT: RepositoryTaskCase[] = [
  { query: 'Trace how task leases are claimed through MCP and verified by separate processes.', relevantPaths: ['src/memory/taskLedger.ts', 'src/mcp/taskTools.ts', 'tests/taskProcesses.test.ts'] },
  { query: 'Review task checkpoint revision fencing and the tests for stale owners.', relevantPaths: ['src/memory/taskLedger.ts', 'src/mcp/taskTools.ts', 'tests/taskLedger.test.ts'] },
  { query: 'Find task source hashing, path containment and freshness checks during restoration.', relevantPaths: ['src/harness/taskSources.ts', 'src/harness/taskContext.ts', 'src/memory/taskLedger.ts'] },
  { query: 'Trace the 600-token task capsule from ledger validation to MCP response.', relevantPaths: ['src/memory/taskLedger.ts', 'src/harness/taskContext.ts', 'src/mcp/taskTools.ts'] },
  { query: 'Review corruption and atomic-write behavior for task and memory ledgers.', relevantPaths: ['src/memory/taskLedger.ts', 'src/memory/sqliteStore.ts', 'tests/sqliteStore.test.ts', 'tests/taskLedger.test.ts'] },
  { query: 'Trace memory records from JSON persistence through temporal storage into BM25 search.', relevantPaths: ['src/memory/sqliteStore.ts', 'src/memory/temporalMemory.ts', 'src/memory/hybridSearch.ts'] },
  { query: 'Review forgotten and superseded memory filtering in storage, search and tests.', relevantPaths: ['src/memory/sqliteStore.ts', 'src/memory/temporalMemory.ts', 'tests/sqliteStore.test.ts', 'tests/hybridSearch.test.ts'] },
  { query: 'Locate artifact-linked memory search implementation and its regression tests.', relevantPaths: ['src/memory/sqliteStore.ts', 'src/memory/hybridSearch.ts', 'tests/hybridSearch.test.ts'] },
  { query: 'Trace memory query MCP routing and graph fusion and test coverage.', relevantPaths: ['src/mcp/server.ts', 'src/memory/hybridSearch.ts', 'tests/mcpQuery.test.ts'] },
  { query: 'Find task resource registration, bounded active list and resource tests.', relevantPaths: ['src/mcp/server.ts', 'src/mcp/taskTools.ts', 'tests/mcpResources.test.ts', 'tests/taskLedger.test.ts'] },
  { query: 'Review MCP task claims and restart recovery in server and process tests.', relevantPaths: ['src/mcp/server.ts', 'src/mcp/taskTools.ts', 'tests/taskProcesses.test.ts'] },
  { query: 'Find MCP context block resource routing and assertions against the context tool.', relevantPaths: ['src/mcp/server.ts', 'src/memory/contextBlock.ts', 'tests/mcpResources.test.ts'] },
  { query: 'Trace context header token estimates and context block rendering and tests.', relevantPaths: ['src/harness/contextHarness.ts', 'src/harness/tokenCompressor.ts', 'src/memory/contextBlock.ts', 'tests/harness.test.ts'] },
  { query: 'Review noise-aware context block selection and its test coverage.', relevantPaths: ['src/memory/contextBlock.ts', 'src/memory/temporalMemory.ts', 'tests/contextBlock.test.ts'] },
  { query: 'Find the context header budget and compression tests for workspace state.', relevantPaths: ['src/harness/contextHarness.ts', 'src/harness/tokenCompressor.ts', 'tests/harness.test.ts'] },
  { query: 'Trace checkpoint execution and merge or rebase safety guards in the tests.', relevantPaths: ['src/hooks/autoCommit.ts', 'tests/autoCommit.test.ts', 'tests/autoCommitGuards.test.ts'] },
  { query: 'Review ghost path detection after rollback and how the context header shows warnings.', relevantPaths: ['src/harness/ghostPaths.ts', 'src/harness/contextHarness.ts', 'tests/ghostPaths.test.ts'] },
  { query: 'Locate process lock use by git checkpoint, task ledger and JSON memory storage.', relevantPaths: ['src/hooks/autoCommit.ts', 'src/memory/taskLedger.ts', 'src/memory/sqliteStore.ts', 'src/memory/fileLock.ts'] },
  { query: 'Review the MCP git checkpoint tool and automatic checkpoint engine tests.', relevantPaths: ['src/mcp/server.ts', 'src/hooks/autoCommit.ts', 'tests/autoCommit.test.ts'] },
  { query: 'Find project graph reading and its use in hybrid search and context generation.', relevantPaths: ['src/memory/structuralGraph.ts', 'src/memory/hybridSearch.ts', 'src/mcp/server.ts', 'src/harness/contextHarness.ts'] },
  ...[
    'What is the production database password?',
    'Which customer signed a confidential enterprise contract?',
    'What is the private production API credential?',
    'Who approved the cloud deployment budget last Tuesday?',
    'What is the revenue from paid subscriptions?',
    'Which hospital patient received the prescription?',
    'Which user reported the last production outage?',
    'What is the unreleased project acquisition price?',
    'Where is the missing private incident investigation?',
    'What is the next quarterly revenue target?'
  ].map(query => ({ query, relevantPaths: [] }))
];

// Separate development queries: component tasks differ from the held-out investigations.
export const DEVELOPMENT: RepositoryTaskCase[] = [
  { query: 'How does the Windows watcher ignore git and generated paths?', relevantPaths: ['src/hooks/fileWatcher.ts', 'tests/fileWatcher.test.ts'] },
  { query: 'Which adapter installs Copilot instructions and Cursor project rules?', relevantPaths: ['src/harness/universalAdapters.ts', 'tests/harness.test.ts'] },
  { query: 'How does rollback create a safety snapshot before restoring files?', relevantPaths: ['src/hooks/autoCommit.ts', 'tests/autoCommit.test.ts'] },
  { query: 'How does doctor verify an MCP server launch handshake?', relevantPaths: ['src/cli/doctor.ts', 'tests/doctorVerify.test.ts'] },
  { query: 'How does removeInjection preserve user-written adapter content?', relevantPaths: ['src/cli/removeCommand.ts', 'tests/removeCommand.test.ts'] },
  { query: 'How does McpAccessEngine resolve platform-specific launch commands?', relevantPaths: ['src/harness/mcpAccess.ts', 'tests/harness.test.ts'] },
  { query: 'Which dashboard rollback requests are accepted and tested?', relevantPaths: ['src/server/dashboardServer.ts', 'tests/dashboard.test.ts'] },
  { query: 'How does package version lookup stay aligned with the manifest?', relevantPaths: ['src/version.ts', 'tests/packageMetadata.test.ts'] },
  { query: 'Which setup steps are printed for enabling IDE integrations?', relevantPaths: ['src/cli/setupOutput.ts', 'tests/setupOutput.test.ts'] },
  { query: 'How does the CLI clamp recall result limits?', relevantPaths: ['src/cli/memoryCommands.ts', 'tests/cli.test.ts'] },
  { query: 'Which file defines `McpAccessEngine` in src/harness/mcpAccess.ts?', relevantPaths: ['src/harness/mcpAccess.ts'] },
  { query: 'What was the final score of last nights cricket match?', relevantPaths: [] },
  { query: 'Which gate is my flight boarding at?', relevantPaths: [] },
  { query: 'What temperature will Mumbai have tomorrow?', relevantPaths: [] },
  { query: 'Give me a pasta recipe with basil and tomato.', relevantPaths: [] },
  { query: 'Who won the Formula One championship this season?', relevantPaths: [] },
  { query: 'Calculate my income tax liability for this year.', relevantPaths: [] },
  { query: 'What is the current price of silver?', relevantPaths: [] },
  { query: 'Which dentist did I visit last month?', relevantPaths: [] },
  { query: 'What is my laptop serial number?', relevantPaths: [] },
  { query: 'Translate the paragraph I forgot to paste into French.', relevantPaths: [] }
];
