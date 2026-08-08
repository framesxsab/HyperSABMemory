/**
 * HyperMemory — Ponytail Harness & YAGNI Decision Ladder
 * Enforces lazy senior developer YAGNI principles (DietrichGebert/ponytail spec)
 * to eliminate code bloat, reduce token usage, and enforce minimal code generation.
 */

export interface PonytailOptions {
  enabled?: boolean;
  strictYagni?: boolean;
}

export class PonytailEngine {
  private enabled: boolean;
  private strictYagni: boolean;

  constructor(options: PonytailOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.strictYagni = options.strictYagni ?? true;
  }

  /**
   * Generates the concise Ponytail YAGNI decision prompt block for agent headers.
   */
  public generatePonytailHeader(): string {
    if (!this.enabled) return '';

    return `🎯 [PONYTAIL YAGNI DECISION LADDER]
1. Does this feature need to exist at all? (Default to NO unless requested)
2. Does it already exist in Graphify codebase graph? (REUSE first)
3. Can standard library or existing dependency cover it? (NO new npm packages)
4. Can it be written in < 15 lines of clear, typed code?
5. Write ONLY the minimum working code. Zero fluff, zero over-engineering.`;
  }
}
