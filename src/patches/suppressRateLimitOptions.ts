// Please see the note about writing patches in ./index

import { showDiff } from './index';

// CC 2.1.247 changed one call site's prop value from a bare identifier to an
// optional-chained member (`onOpenRateLimitOptions:m?.openRateLimitOptions`).
// Reading only `[$\w]+` rewrote the `m` and left the `?.openRateLimitOptions`
// dangling, emitting `()=>{}?.openRateLimitOptions` — a syntax error that Bun
// refuses, which would brick Claude Code on --apply. The patch is config-gated
// so a real apply never ran it; only `pnpm test:pristine` saw it. Read the WHOLE
// value expression instead: scan to the first `,` or `}` at nesting depth 0,
// skipping strings, templates and nested brackets.
const readValueEnd = (file: string, valueStart: number): number | null => {
  let depth = 0;
  let i = valueStart;
  while (i < file.length) {
    const ch = file[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < file.length) {
        if (file[i] === '\\') {
          i += 2;
          continue;
        }
        if (file[i] === quote) break;
        i += 1;
      }
      if (i >= file.length) return null;
      i += 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      if (depth === 0) return null;
      depth -= 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (depth === 0) return i;
      depth -= 1;
      i += 1;
      continue;
    }
    if (ch === ',' && depth === 0) return i;
    i += 1;
  }
  return null;
};

const isHelperPropCall = (file: string, propIndex: number): boolean => {
  const lastOpen = file.lastIndexOf('{', propIndex);
  if (lastOpen === -1) return false;
  const lastClose = file.lastIndexOf('}', propIndex);
  if (lastClose > lastOpen) return false;
  const prefix = file.slice(Math.max(0, lastOpen - 80), lastOpen);
  return /[$\w]+\([$\w]+,$/.test(prefix);
};

export const writeSuppressRateLimitOptions = (
  oldFile: string
): string | null => {
  const patterns = [
    // Method 3 (CC >= 2.1.186): the React jsx() runtime replaced
    // createElement, so the message-list props object is now built by
    // `X.jsx(Y,{...,showAllInTranscript:A,agentDefinitions:B,onOpenRateLimitOptions:CB`
    // (agentDefinitions and showAllInTranscript appear in either order).
    /\.jsx\([$\w]+,\{.{0,800}?showAllInTranscript:[$\w!.]+,.{0,240}?onOpenRateLimitOptions:([$\w]+)/g,
    /\.createElement.{0,500},showAllInTranscript:[$\w]+,agentDefinitions:[$\w]+,onOpenRateLimitOptions:([$\w]+)/g,
    /\.createElement\([\w$]+,\{messages:[\w$]+,tools:[\w$]+,commands:[\w$]+,verbose:!0,toolJSX:null,inProgressToolUseIDs:[\w$]+,isMessageSelectorVisible:!1,conversationId:[\w$]+,screen:[\w$]+,agentDefinitions:[\w$]+,streamingToolUses:[\w$]+,showAllInTranscript:[\w$]+,onOpenRateLimitOptions:([\w$]+)/g,
  ];

  let newFile = oldFile;
  let replacements = 0;

  // Method 4 (CC >= 2.1.246): jsx/jsxs are imported bindings, so the call is
  // `i(uR,{...,onOpenRateLimitOptions:sue,...})` with no `.jsx`. Walk each
  // `onOpenRateLimitOptions:` and keep only those that sit in a helper-call
  // props object (not a destructure). indexOf so we do not scan 36 MB with
  // `[^{}]{0,1200}?`.
  {
    const anchor = 'onOpenRateLimitOptions:';
    const sites: { start: number; end: number }[] = [];
    let from = 0;
    while (true) {
      const at = newFile.indexOf(anchor, from);
      if (at === -1) break;
      const valueStart = at + anchor.length;
      if (newFile.startsWith('()=>{}', valueStart)) {
        from = valueStart + 6;
        continue;
      }
      if (!isHelperPropCall(newFile, at)) {
        from = valueStart;
        continue;
      }
      const valueEnd = readValueEnd(newFile, valueStart);
      if (valueEnd === null || valueEnd <= valueStart) {
        from = valueStart;
        continue;
      }
      sites.push({ start: valueStart, end: valueEnd });
      from = valueEnd;
    }
    for (const site of sites.reverse()) {
      const newCode = '()=>{}';
      const updatedFile =
        newFile.slice(0, site.start) + newCode + newFile.slice(site.end);
      showDiff(newFile, updatedFile, newCode, site.start, site.end);
      newFile = updatedFile;
      replacements++;
    }
  }

  for (const pattern of patterns) {
    const matches = [...newFile.matchAll(pattern)];
    for (const match of matches.reverse()) {
      if (match.index === undefined) continue;

      const callbackVar = match[1];
      const callbackStart = match.index + match[0].length - callbackVar.length;
      const callbackEnd = callbackStart + callbackVar.length;
      const newCode = '()=>{}';

      const updatedFile =
        newFile.slice(0, callbackStart) + newCode + newFile.slice(callbackEnd);

      showDiff(newFile, updatedFile, newCode, callbackStart, callbackEnd);
      newFile = updatedFile;
      replacements++;
    }
  }

  if (replacements === 0) {
    if (oldFile.includes('onOpenRateLimitOptions:()=>{}')) return oldFile;
    console.error(
      'patch: suppressRateLimitOptions: failed to find onOpenRateLimitOptions pattern'
    );
    return null;
  }

  return newFile;
};
