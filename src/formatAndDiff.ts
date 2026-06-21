import { structuredPatch } from 'diff';

import { debug } from './utils';

// ======================================================================
// Types
// ======================================================================

export interface FormatDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FormatDiffResult {
  hunks: FormatDiffHunk[];
  changeCount: number;
  formattedLines: number;
  timings: {
    formatMs: number;
    diffMs: number;
    totalMs: number;
  };
}

/**
 * Returned instead of a diff when formatting couldn't produce one. `reason`
 * distinguishes a benign missing formatter from a parse failure; for the latter
 * `modifiedFailed && !originalFailed` is a corruption signal (the patch made the
 * JS unparseable while the original was fine).
 */
export interface FormatDiffSkipped {
  reason: 'oxfmt-unavailable' | 'format-error';
  originalFailed: boolean;
  modifiedFailed: boolean;
}

export type FormatDiffOutcome = FormatDiffResult | FormatDiffSkipped;

// ======================================================================
// oxfmt lazy loader (graceful fallback when native binary unavailable)
// ======================================================================

type OxfmtFormat = (
  fileName: string,
  sourceText: string,
  options?: Record<string, unknown>
) => Promise<{ code: string; errors: unknown[] }>;

let oxfmtFormat: OxfmtFormat | null | undefined;

async function getOxfmtFormat(): Promise<OxfmtFormat | null> {
  if (oxfmtFormat !== undefined) return oxfmtFormat;
  try {
    const mod = await import('oxfmt');
    oxfmtFormat = mod.format;
    return oxfmtFormat;
  } catch (error) {
    debug('Failed to load oxfmt:', error);
    oxfmtFormat = null;
    return null;
  }
}

// ======================================================================
// Core: format two strings and diff them
// ======================================================================

export async function formatAndDiff(
  original: string,
  modified: string,
  options?: { contextLines?: number; printWidth?: number }
): Promise<FormatDiffOutcome> {
  const fmt = await getOxfmtFormat();
  if (!fmt) {
    debug('oxfmt unavailable, skipping format+diff');
    return {
      reason: 'oxfmt-unavailable',
      originalFailed: false,
      modifiedFailed: false,
    };
  }

  const contextLines = options?.contextLines ?? 10;
  const printWidth = options?.printWidth ?? 80;

  const t0 = performance.now();

  const [fmtOrig, fmtMod] = await Promise.all([
    fmt('original.js', original, { printWidth }),
    fmt('modified.js', modified, { printWidth }),
  ]);

  const tFmt = performance.now();

  if (fmtOrig.errors.length > 0 || fmtMod.errors.length > 0) {
    debug(
      'oxfmt format errors:',
      'original:',
      fmtOrig.errors,
      'modified:',
      fmtMod.errors
    );
    return {
      reason: 'format-error',
      originalFailed: fmtOrig.errors.length > 0,
      modifiedFailed: fmtMod.errors.length > 0,
    };
  }

  const patch = structuredPatch(
    'original.js',
    'modified.js',
    fmtOrig.code,
    fmtMod.code,
    '',
    '',
    { context: contextLines }
  );

  const tDiff = performance.now();

  return {
    hunks: patch.hunks,
    changeCount: patch.hunks.length,
    formattedLines: fmtOrig.code.split('\n').length,
    timings: {
      formatMs: tFmt - t0,
      diffMs: tDiff - tFmt,
      totalMs: tDiff - t0,
    },
  };
}
