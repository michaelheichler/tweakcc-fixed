/**
 * Content I/O Utilities
 *
 * Read and write Claude Code's JavaScript content.
 * Handles both npm (cli.js) and native binary installations.
 */

import * as fs from 'node:fs/promises';

import {
  extractClaudeJsFromNativeInstallation,
  repackNativeInstallation,
} from '../nativeInstallationLoader';
import { replaceFileBreakingHardLinks } from '../utils';
import { Installation } from './types';

// ============================================================================
// Public API
// ============================================================================

/**
 * Read Claude Code's JavaScript content.
 *
 * - npm installs: reads cli.js directly
 * - native installs: extracts embedded JS from binary
 *
 * @param installation - The installation to read from
 * @returns An object with `content` (the JavaScript as a string) and
 *   `clearBytecode`, a flag that must be passed back to {@link writeContent}.
 *   It is `true` only for native Bun installs whose embedded bytecode cache
 *   must be invalidated after the JS changes; always `false` for npm installs.
 */
export async function readContent(
  installation: Installation
): Promise<{ content: string; clearBytecode: boolean }> {
  if (installation.kind === 'native') {
    const {
      data: buffer,
      clearBytecode,
      error: extractError,
    } = await extractClaudeJsFromNativeInstallation(installation.path);
    if (!buffer) {
      throw new Error(
        `Failed to extract JavaScript from native installation: ${installation.path}${
          extractError ? ` (${extractError})` : ''
        }`
      );
    }
    return { content: buffer.toString('utf8'), clearBytecode };
  } else {
    const content = await fs.readFile(installation.path, { encoding: 'utf8' });
    return { content, clearBytecode: false };
  }
}

/**
 * Write modified JavaScript content back to Claude Code.
 *
 * - npm installs: writes to cli.js (handles permissions, hard links)
 * - native installs: repacks JS into binary
 *
 * @param installation - The installation to write to
 * @param content - The modified JavaScript content
 * @param clearBytecode - Pass the value returned by {@link readContent}. For
 *   native Bun installs it clears the embedded bytecode cache so the new JS is
 *   re-parsed (stale bytecode would otherwise keep running the OLD code);
 *   ignored for npm installs.
 */
export async function writeContent(
  installation: Installation,
  content: string,
  clearBytecode: boolean
): Promise<void> {
  if (installation.kind === 'native') {
    const modifiedBuffer = Buffer.from(content, 'utf8');
    await repackNativeInstallation(
      installation.path,
      modifiedBuffer,
      installation.path,
      clearBytecode
    );
  } else {
    await replaceFileBreakingHardLinks(installation.path, content, 'patch');
  }
}
