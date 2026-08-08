import { describe, it, expect } from 'vitest';
import { OhMyPiHarness } from '../src/harness/ohMyPi.js';
import { TokenCompressor } from '../src/harness/tokenCompressor.js';
import { HashAnchorEngine } from '../src/harness/hashAnchor.js';
import { GraphifyEngine } from '../src/memory/graphify.js';
import { PonytailEngine } from '../src/harness/ponytail.js';
import { UniversalAdaptersEngine } from '../src/harness/universalAdapters.js';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';

describe('HyperMemory — Oh-My-Pi Harness Tests', () => {
  it('should generate compressed state header', () => {
    const harness = new OhMyPiHarness(1500);
    const header = harness.generateHeader({
      workspaceName: 'HyperMemory',
      activeFile: 'src/index.ts',
      modifiedFiles: ['src/hooks/autoCommit.ts'],
      memorySummary: 'Unit test execution'
    });

    expect(header).toContain('HYPERMEMORY :: OH-MY-PI + PONYTAIL HARNESS');
    expect(header).toContain('src/index.ts');
  });

  it('should compress long diff text under token limit', () => {
    const longText = 'A'.repeat(10000);
    const compressed = TokenCompressor.compressText(longText, 100);
    expect(TokenCompressor.estimateTokens(compressed)).toBeLessThanOrEqual(150);
  });

  it('should generate and verify hash anchors correctly', () => {
    const content = 'function hello() { return "world"; }';
    const hash = HashAnchorEngine.computeHash(content);
    expect(hash.length).toBe(8);
    expect(HashAnchorEngine.verifyAnchor(content, hash)).toBe(true);
    expect(HashAnchorEngine.verifyAnchor('different content', hash)).toBe(false);
  });

  it('should format Graphify structural knowledge summary', () => {
    const graphify = new GraphifyEngine(process.cwd());
    const summary = graphify.getGraphSummary();
    expect(summary).toContain('Graphify');
  });

  it('should format Ponytail YAGNI decision ladder header', () => {
    const ponytail = new PonytailEngine({ enabled: true });
    const header = ponytail.generatePonytailHeader();
    expect(header).toContain('PONYTAIL YAGNI DECISION LADDER');
  });

  it('should generate universal IDE rules across Cursor, Windsurf, Copilot, and Claude Code', () => {
    const adapters = new UniversalAdaptersEngine(process.cwd());
    const res = adapters.syncAllAdapters();
    expect(res.cursor).toBe(true);
    expect(res.windsurf).toBe(true);
    expect(res.createdFiles.length).toBeGreaterThan(0);
  });

  it('should execute Quad-Hybrid search query', () => {
    const hybrid = new HybridSearchEngine(process.cwd());
    const results = hybrid.search('HyperMemory');
    expect(Array.isArray(results)).toBe(true);
  });
});
