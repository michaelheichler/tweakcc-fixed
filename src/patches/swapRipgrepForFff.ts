// Please see the note about writing patches in ./index
//
// [EXPERIMENTAL] Backs Claude Code's Grep with fff (fast file finder) for
// eligible exact content searches, KEEPING ripgrep as an automatic fallback for
// everything fff can't do (regex, multiline, --files/Glob enumeration, count,
// single-file/out-of-root, non-ASCII). Both engines ship; this is not a removal
// of ripgrep. See fff_implementation_plan.md.
//
// Two transforms, applied in order:
//
//   1. Resolver repoint [CRITICAL]. The resolver's embedded descriptor is a
//      fixed literal with NO minified identifiers, so a literal match is more
//      robust than a regex:
//        {mode:"embedded",command:process.execPath,args:["--no-config"],argv0:"rg"}
//      becomes a system-mode descriptor pointing at our wrapper, passing the
//      LIVE claude binary path via process.execPath (resolved at CC runtime, so
//      it survives `claude update`) so the wrapper can re-exec the embedded
//      ripgrep for fallback.
//
//   2. Grep-description guidance [BEST-EFFORT, APPEND-ONLY]. fff's own usage
//      best-practices (adapted from its MCP server instructions) are APPENDED to
//      the Grep tool description so the model uses fff well. This runs after the
//      system-prompt/reminder (lobotomization) pipeline and only ever INSERTS
//      text before the description template's closing backtick — it never
//      rewrites existing content, so it lands on top of any edited prompt.

import { debug } from '../utils';
import { showDiff } from './index';

const EMBEDDED_DESCRIPTOR =
  '{mode:"embedded",command:process.execPath,args:["--no-config"],argv0:"rg"}';

const EMBEDDED_RE =
  /\{mode:"embedded",command:process\.execPath,args:\[[^\]]*\],argv0:"rg"\}/;

// Anchor present in BOTH Grep description variants the GY/`xh` gate selects:
// the FULL "A powerful search tool built on ripgrep" and the CONCISE/velvet
// "Content search built on ripgrep" (rendered for opus-4-8/fable-5/mythos-5).
// We append to both so the guidance reaches the model regardless of which
// variant renders. The guidance text must contain NO backticks and NO `${` so
// it is valid content inside the description's template literal.
const GREP_DESC_ANCHOR = 'built on ripgrep';
const FFF_GUIDANCE_MARKER = 'Search backend note (fff):';
const FFF_GUIDANCE =
  '\n\n' +
  FFF_GUIDANCE_MARKER +
  ' this tool is now powered by fff (a fast, typo-resistant file finder) for exact content searches, with ripgrep kept as an automatic fallback. For best results and speed:\n' +
  '- Prefer a single bare identifier (e.g. getUserById, InProgressQuote) over regex, code syntax, or multi-word phrases. fff ranks likely definitions first and is fastest and most accurate on plain identifiers.\n' +
  '- Results are relevance-ranked, so the most relevant file tends to come first; read the top result before searching again.\n' +
  '- Regex patterns, multiline, type filters, and whole-tree/Glob enumeration still work exactly as before (handled automatically by ripgrep) - no capability is lost.\n' +
  '- To find naming variants (snake_case and PascalCase of the same name), run them as separate searches.\n' +
  '- Stop after about two searches and read the code; more search rounds rarely improve understanding.';

const repointResolver = (
  file: string,
  wrapperPath: string
): string | null => {
  let start = file.indexOf(EMBEDDED_DESCRIPTOR);
  let end = start === -1 ? -1 : start + EMBEDDED_DESCRIPTOR.length;

  if (start === -1) {
    const m = file.match(EMBEDDED_RE);
    if (!m || m.index === undefined) {
      console.error(
        'patch: swapRipgrepForFff: failed to find embedded ripgrep resolver descriptor'
      );
      return null;
    }
    start = m.index;
    end = m.index + m[0].length;
  }

  const replacement =
    `{mode:"system",command:${JSON.stringify(wrapperPath)},` +
    `args:["--fff-claude-bin="+process.execPath]}`;
  const newFile = file.slice(0, start) + replacement + file.slice(end);
  showDiff(file, newFile, replacement, start, end);
  return newFile;
};

// Append fff guidance before the closing backtick of EACH Grep description
// template (full + concise). Append-only; logs and no-ops if the shape isn't
// found (the resolver repoint is the critical part, so we never fail here).
const appendGrepGuidance = (file: string): string => {
  if (file.includes(FFF_GUIDANCE_MARKER)) return file; // idempotent

  // Collect the closing-backtick position of every grep description template by
  // scanning forward from each "built on ripgrep" occurrence to the first
  // unescaped backtick (the descriptions use \` for inner code spans).
  const inserts: number[] = [];
  let from = 0;
  for (;;) {
    const a = file.indexOf(GREP_DESC_ANCHOR, from);
    if (a === -1) break;
    let j = a;
    while (j < file.length && !(file[j] === '`' && file[j - 1] !== '\\')) j++;
    if (j < file.length) inserts.push(j);
    from = a + GREP_DESC_ANCHOR.length;
  }

  if (inserts.length === 0) {
    debug(
      'patch: swapRipgrepForFff: Grep description not found; skipping fff guidance append'
    );
    return file;
  }

  // Insert from the highest index down so earlier positions do not shift.
  let out = file;
  for (const pos of inserts.sort((x, y) => y - x)) {
    out = out.slice(0, pos) + FFF_GUIDANCE + out.slice(pos);
  }
  showDiff(file, out, FFF_GUIDANCE, inserts[inserts.length - 1], inserts[0]);
  return out;
};

export const writeSwapRipgrepForFff = (
  oldFile: string,
  wrapperPath: string
): string | null => {
  let file = oldFile;

  // 1. Resolver repoint (critical). Idempotent on our injected sentinel.
  if (!file.includes('--fff-claude-bin=')) {
    const repointed = repointResolver(file, wrapperPath);
    if (repointed === null) return null;
    file = repointed;
  }

  // 2. Append fff guidance to the Grep description (best-effort, append-only,
  //    on top of the already-applied edited prompts).
  file = appendGrepGuidance(file);

  return file;
};
