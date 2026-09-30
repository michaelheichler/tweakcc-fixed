// Please see the note about writing patches in ./index

import { showDiff } from './index';

// CC builds each thinking-spinner frame list by appending the reversed list to
// itself so the animation "bounces". It has written that two ways:
//
//   2.1.238 and earlier   KLw=[...c9l,...[...c9l].reverse()]
//   2.1.239               KLw=[...c9l,...c9l.toReversed()]
//
// `toReversed()` returns a copy, so the defensive inner spread is redundant and
// Anthropic dropped it. Nothing else about the site changed. Match either form
// — the old one stays because tweakcc supports older CC builds, and an arm that
// no longer matches costs nothing.
const MIRROR_PATTERN =
  /=\[\.\.\.([$\w]+),\.\.\.(?:\[\.\.\.\1\]\.reverse\(\)|\1\.toReversed\(\))\]/g;

export const writeThinkerSymbolMirrorOption = (
  oldFile: string,
  enableMirror: boolean
): string | null => {
  // 2.1.239 ships THREE frame lists (plain, unicode-fallback and ASCII-`*`
  // variants: KLw/YLw/RJD). Patching only the first left the other two
  // bouncing, so which variant the terminal selected decided whether the
  // setting appeared to work. Rewrite every occurrence.
  const matches = [...oldFile.matchAll(MIRROR_PATTERN)];

  if (matches.length === 0) {
    // Idempotency: an already-unmirrored build has nothing to rewrite.
    if (/=\[\.\.\.[$\w]+\],/.test(oldFile) && !enableMirror) return oldFile;
    console.error('patch: thinker symbol mirror option: failed to find match');
    return null;
  }

  let newFile = '';
  let cursor = 0;
  let lastReplacement = '';
  let lastStart = 0;
  let lastEnd = 0;

  for (const match of matches) {
    const start = match.index;
    if (start === undefined) continue;
    const varName = match[1];
    const replacement = enableMirror
      ? `=[...${varName},...${varName}.toReversed()]`
      : `=[...${varName}]`;
    newFile += oldFile.slice(cursor, start) + replacement;
    cursor = start + match[0].length;
    lastReplacement = replacement;
    lastStart = newFile.length - replacement.length;
    lastEnd = newFile.length;
  }
  newFile += oldFile.slice(cursor);

  showDiff(oldFile, newFile, lastReplacement, lastStart, lastEnd);
  return newFile;
};
