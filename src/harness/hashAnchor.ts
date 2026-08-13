/**
 * HyperMemory — Hash-Anchored Edit Engine (oh-my-pi baseline)
 * Computes content hashes for files and blocks to ensure conflict-free, precise state edits.
 */

import * as crypto from 'crypto';

export interface HashAnchor {
  filePath: string;
  hash: string;
  timestamp: number;
}

export class HashAnchorEngine {
  /**
   * Generates a 8-character hex hash for a given content string.
   */
  public static computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
  }

  /**
   * Validates if target content matches expected anchor hash.
   */
  public static verifyAnchor(content: string, expectedHash: string): boolean {
    const actualHash = this.computeHash(content);
    return actualHash === expectedHash;
  }

  /**
   * Wraps a file snippet with hash-anchored metadata tags.
   */
  public static formatAnchoredSnippet(filePath: string, content: string, startLine: number = 1): string {
    const hash = this.computeHash(content);
    return `[ANCHOR:${filePath}#L${startLine}:${hash}]\n${content}\n[/ANCHOR:${hash}]`;
  }

  /**
   * Oh-My-Pi hashline: path + line range + content hash for conflict-free patches.
   */
  public static formatHashline(filePath: string, content: string, startLine: number, endLine: number): string {
    const hash = this.computeHash(content);
    return `#H ${filePath} L${startLine}-${endLine} ${hash}`;
  }
}
