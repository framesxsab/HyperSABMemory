/**
 * HyperMemory — Token Compressor Utility
 * Ensures Oh-My-Pi context headers never exceed specified token ceilings.
 */

export interface CompressionOptions {
  maxTokens?: number;
  preserveFocus?: boolean;
}

export class TokenCompressor {
  // Approximate character-to-token ratio (4 chars ≈ 1 token)
  private static CHARS_PER_TOKEN = 4;

  /**
   * Estimates token count for a given text string.
   */
  public static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }

  /**
   * Truncates text to fit within a given token budget.
   */
  public static compressText(text: string, maxTokens: number = 1500): string {
    const currentTokens = this.estimateTokens(text);
    if (currentTokens <= maxTokens) {
      return text;
    }

    const maxChars = maxTokens * this.CHARS_PER_TOKEN;
    const truncated = text.slice(0, maxChars - 100);
    return `${truncated}\n... [HyperMemory: Compressed ${currentTokens - maxTokens} tokens] ...`;
  }

  /**
   * Formats git diffs into a compact token-efficient representation.
   */
  public static formatCompactDiff(diffRaw: string, maxLines: number = 20): string {
    if (!diffRaw) return 'No uncommitted changes';
    const lines = diffRaw.split('\n');
    if (lines.length <= maxLines) return diffRaw;

    const summaryHead = lines.slice(0, maxLines / 2).join('\n');
    const summaryTail = lines.slice(-maxLines / 2).join('\n');
    return `${summaryHead}\n... [+${lines.length - maxLines} lines omitted] ...\n${summaryTail}`;
  }
}
