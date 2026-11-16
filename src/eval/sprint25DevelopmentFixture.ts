import type { RepositoryTaskCase } from './repositoryTaskFixture.js';

// New development-only tasks target cross-layer source paths; never use this list as held-out evidence.
export const SPRINT25_DEVELOPMENT: RepositoryTaskCase[] = [
  { query: 'How does task creation capture source hashes and restore a bounded capsule through MCP?', relevantPaths: ['src/memory/taskLedger.ts', 'src/harness/taskSources.ts', 'src/harness/taskContext.ts', 'src/mcp/taskTools.ts', 'tests/taskProcesses.test.ts'] },
  { query: 'How does setup seed project facts, install agent rules, and connect the MCP server?', relevantPaths: ['src/cli/oneShotSetup.ts', 'src/memory/seeding.ts', 'src/harness/universalAdapters.ts', 'src/harness/mcpAccess.ts', 'tests/seeding.test.ts', 'tests/harness.test.ts'] },
  { query: 'How are task source paths contained and same-size source rewrites detected on restoration?', relevantPaths: ['src/harness/taskSources.ts', 'src/harness/taskContext.ts', 'src/memory/taskLedger.ts', 'tests/taskLedger.test.ts'] },
  { query: 'How does an MCP context request combine active file state with graph and compact memory context?', relevantPaths: ['src/mcp/server.ts', 'src/harness/contextHarness.ts', 'src/memory/structuralGraph.ts', 'src/memory/contextBlock.ts', 'tests/mcpResources.test.ts'] },
  { query: 'How does a remembered fact persist through JSON storage, temporal access, and MCP hybrid search?', relevantPaths: ['src/memory/sqliteStore.ts', 'src/memory/temporalMemory.ts', 'src/memory/hybridSearch.ts', 'src/mcp/server.ts', 'tests/hybridSearch.test.ts', 'tests/mcpQuery.test.ts'] },
  { query: 'How do forgotten and superseded facts stay out of active memory retrieval?', relevantPaths: ['src/memory/sqliteStore.ts', 'src/memory/temporalMemory.ts', 'src/memory/hybridSearch.ts', 'tests/sqliteStore.test.ts', 'tests/hybridSearch.test.ts'] },
  { query: 'How does rollback preserve a safety checkpoint and expose ghost paths in restored context?', relevantPaths: ['src/hooks/autoCommit.ts', 'src/harness/ghostPaths.ts', 'src/harness/contextHarness.ts', 'tests/autoCommit.test.ts', 'tests/ghostPaths.test.ts'] },
  { query: 'How do MCP task claims use the ledger lock and prevent simultaneous process ownership?', relevantPaths: ['src/mcp/server.ts', 'src/mcp/taskTools.ts', 'src/memory/taskLedger.ts', 'src/memory/fileLock.ts', 'tests/taskProcesses.test.ts'] },
  { query: 'How are task revisions fenced and task writes recovered after a process failure?', relevantPaths: ['src/memory/taskLedger.ts', 'src/memory/fileLock.ts', 'src/mcp/taskTools.ts', 'tests/taskLedger.test.ts', 'tests/taskProcesses.test.ts'] },
  { query: 'How does the project file watcher trigger safe automatic checkpoints and suppress noisy paths?', relevantPaths: ['src/hooks/fileWatcher.ts', 'src/hooks/autoCommit.ts', 'src/memory/fileLock.ts', 'tests/fileWatcher.test.ts', 'tests/autoCommitGuards.test.ts'] },
  { query: 'What is the maintainer favorite color?', relevantPaths: [] },
  { query: 'How many unread email messages does the maintainer have?', relevantPaths: [] },
  { query: 'Which private calendar meeting is next?', relevantPaths: [] },
  { query: 'What is the balance in the maintainer bank account?', relevantPaths: [] },
  { query: 'Which password is saved in the maintainer browser password manager?', relevantPaths: [] },
  { query: 'What was the last web search made outside this repository?', relevantPaths: [] },
  { query: 'How many photographs are stored on the maintainer phone?', relevantPaths: [] },
  { query: 'What temperature is the maintainer laptop CPU running at?', relevantPaths: [] },
  { query: 'Which appointment is on the maintainer personal calendar?', relevantPaths: [] },
  { query: 'What did the maintainer discuss on their last phone call?', relevantPaths: [] },
  { query: 'What documented boundaries connect task coordination, persisted memory, and compact context delivery?', relevantPaths: ['Architecture.md', 'src/memory/sqliteStore.ts', 'src/harness/contextHarness.ts', 'src/mcp/server.ts', 'tests/mcpResources.test.ts'] }
];
