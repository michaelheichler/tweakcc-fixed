/**
 * tweakcc Library
 *
 * Claude Code patching utilities - the building blocks that tweakcc uses,
 * exposed for others to build their own tools.
 *
 * @example
 * ```typescript
 * import {
 *   findAllInstallations,
 *   tryDetectInstallation,
 *   readContent,
 *   writeContent,
 *   backupFile,
 *   helpers,
 * } from 'tweakcc';
 *
 * // Find Claude Code
 * const installation = await tryDetectInstallation({ interactive: true });
 *
 * // Backup first
 * await backupFile(installation.path, './backup');
 *
 * // Read, patch, write
 * const { content, clearBytecode } = await readContent(installation);
 * const modified = content.replace(/something/g, 'something else');
 * await writeContent(installation, modified, clearBytecode);
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  Installation,
  // Re-exported config types
  TweakccConfig,
  Settings,
} from './types';

// ============================================================================
// Installation Detection
// ============================================================================

export {
  findAllInstallations,
  tryDetectInstallation,
  showInteractiveInstallationPicker,
  type DetectInstallationOptions,
} from './detection';

// ============================================================================
// Content I/O
// ============================================================================

export { readContent, writeContent } from './content';

// ============================================================================
// Backup & Restore
// ============================================================================

export { backupFile, restoreBackup } from './backup';

// ============================================================================
// Tweakcc Config
// ============================================================================

export {
  getTweakccConfigDir,
  getTweakccConfigPath,
  getTweakccSystemPromptsDir,
  readTweakccConfig,
} from './config';

// ============================================================================
// Helpers
// ============================================================================

import {
  findChalkVar,
  getModuleLoaderFunction,
  getReactVar,
  getRequireFuncName,
  findTextComponent,
  findBoxComponent,
  clearCaches,
} from '../patches/helpers';

import { globalReplace, showDiff } from '../patches/patchDiffing';

/**
 * Helper utilities for writing patches against minified code.
 *
 * Includes functions to find minified variable names and utilities for
 * performing replacements with diff output.
 *
 * @example
 * ```typescript
 * const reactVar = helpers.getReactVar(content);
 * if (reactVar) {
 *   content = content.replace(
 *     new RegExp(`${reactVar}\\.createElement`),
 *     // ...
 *   );
 * }
 *
 * // Clear caches when processing multiple files
 * helpers.clearCaches();
 * ```
 */
export const helpers = {
  // Find minified identifiers
  findChalkVar,
  getModuleLoaderFunction,
  getReactVar,
  getRequireFuncName,
  findTextComponent,
  findBoxComponent,

  // Cache management
  clearCaches,

  // Diff utilities
  globalReplace,
  showDiff,

  // Intentionally curated to the high-level entry points. The lower-level
  // building blocks behind them are NOT re-exported here on purpose:
  //   - getReactModuleNameNonBun / getReactModuleFunctionBun → internals of getReactVar
  //   - findRequireFunc → internal of getRequireFuncName
  //   - clearReactVarCache / clearRequireFuncNameCache → the clearCaches umbrella
  //     already invalidates both
  // The package shares those internals via src/patches/index.ts; the published
  // library surface deliberately keeps them out to avoid committing to internals.
};
