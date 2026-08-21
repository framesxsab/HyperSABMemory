/**
 * HyperSABMemory — Minimal-Change Rules Engine
 * Enforces lazy senior developer YAGNI principles
 * to eliminate code bloat, reduce token usage, and enforce minimal code generation.
 */

export type MinimalChangeIntensity = 'lite' | 'full' | 'ultra';

export interface MinimalChangeOptions {
  enabled?: boolean;
  strictYagni?: boolean;
  intensity?: MinimalChangeIntensity;
}

export class MinimalChangeEngine {
  private enabled: boolean;
  private strictYagni: boolean;
  private intensity: MinimalChangeIntensity;

  constructor(options: MinimalChangeOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.strictYagni = options.strictYagni ?? true;
    this.intensity = options.intensity ?? 'full';
  }

  /**
   * Generates the concise minimal-change rules prompt block for agent headers.
   */
  public generateMinimalChangeHeader(): string {
    if (!this.enabled) return '';

    switch (this.intensity) {
      case 'lite':
        return `🎯 [MINIMAL-CHANGE RULES :: lite]
Reuse structural knowledge graph components. No new deps. Minimum working code.`;
      case 'full':
        return `🎯 [MINIMAL-CHANGE RULES]
1. Does this feature need to exist at all? (Default to NO unless requested)
2. Does it already exist in the structural knowledge graph? (REUSE first)
3. Can standard library or existing dependency cover it? (NO new npm packages)
4. Can it be written in < 15 lines of clear, typed code?
5. Write ONLY the minimum working code. Zero fluff, zero over-engineering.`;
      case 'ultra':
        return `🎯 [MINIMAL-CHANGE RULES :: ultra]
1. Does this feature need to exist at all? (Default to NO unless requested)
2. Does it already exist in the structural knowledge graph? (REUSE first)
3. Can standard library or existing dependency cover it? (NO new npm packages)
4. Can it be written in < 15 lines of clear, typed code?
5. Write ONLY the minimum working code. Zero fluff, zero over-engineering.
6. Inject these rules into every subagent. Harvest deferred shortcuts as debt.
7. Strict: ${this.strictYagni ? 'ON' : 'OFF'}`;
      default: {
        const _exhaustive: never = this.intensity;
        return _exhaustive;
      }
    }
  }
}
