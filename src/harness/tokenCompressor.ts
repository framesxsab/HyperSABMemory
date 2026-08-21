/**
 * HyperSABMemory — Token Compressor Utility
 * Ensures context harness headers never exceed specified token ceilings.
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
    return `${truncated}\n... [HyperSABMemory: Compressed ${currentTokens - maxTokens} tokens] ...`;
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

  /**
   * Summarized file read: keep head/tail lines instead of dumping the whole file.
   */
  public static summarizeRead(content: string, maxLines: number = 24): string {
    if (!content) return '(empty)';
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;

    const headCount = Math.ceil(maxLines * 0.66);
    const tailCount = maxLines - headCount;
    const head = lines.slice(0, headCount).join('\n');
    const tail = lines.slice(-tailCount).join('\n');
    return `${head}\n... [summarized read: ${lines.length - maxLines} lines omitted] ...\n${tail}`;
  }
}
