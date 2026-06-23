// Please see the note about writing patches in ./index
//
// [EXPERIMENTAL] Routes Claude Code's Bash content/file search through our `fff`
// multicall wrapper (which serves fff for eligible literal searches and re-execs
// the real embedded tool otherwise). KEEPS every engine; nothing is removed.
//
// CC 2.1.186 does NOT expose a Grep/Glob tool to the main agent (the search-tools
// gate). Instead it SHADOWS the shell `grep`→embedded `ugrep` and `find`→embedded
// `bfs` in its own shell snapshot, and offers `rg` separately. The model runs
// `grep` ~136x more than `rg` (measured), so the high-value target is the
// ugrep/bfs shadow, not ripgrep. We repoint all three at the wrapper.
//
// Three transforms, in priority order:
//   1. [CRITICAL] Bash-search shadow repoint. The snapshot-generator emits
//      `ARGV0=${t} "$_cc_bin" ${o}` (×2: zsh/win32) and `(exec -a ${t} "$_cc_bin"
//      ${o})` (×1: else), where ${t} is ugrep|bfs and $_cc_bin is the claude
//      binary. We swap "$_cc_bin" → our wrapper (3 occurrences, all in this
//      template). The model's grep/find then transparently hit fff; the wrapper
//      re-execs the real embedded ugrep/bfs (via CLAUDE_CODE_EXECPATH) on miss.
//   2. [BEST-EFFORT] ripgrep resolver repoint — the embedded descriptor
//      {mode:"embedded",command:process.execPath,args:["--no-config"],argv0:"rg"}
//      → system-mode wrapper. Catches the rare `rg` calls + the Grep tool that
//      SUBAGENTS still receive (local-agent entrypoint). process.execPath is
//      forwarded so the wrapper can re-exec the embedded rg for fallback.
//   3. [BEST-EFFORT] fff usage guidance appended to BOTH Grep tool description
//      variants (full + concise/velvet) — only seen by subagents that have the
//      Grep tool; harmless otherwise. Append-only, on top of edited prompts.

import { debug } from '../utils';
import { showDiff } from './index';

// ── 1. Bash-search shadow (ugrep/bfs) — CRITICAL ──────────────────────────────
const SHADOW_TOKEN = '"$_cc_bin"';

// ── 2. ripgrep resolver — best-effort ─────────────────────────────────────────
const EMBEDDED_DESCRIPTOR =
  '{mode:"embedded",command:process.execPath,args:["--no-config"],argv0:"rg"}';
const EMBEDDED_RE =
  /\{mode:"embedded",command:process\.execPath,args:\[[^\]]*\],argv0:"rg"\}/;

// ── 3. Grep-description guidance — best-effort ────────────────────────────────
const GREP_DESC_ANCHOR = 'built on ripgrep';
const FFF_GUIDANCE_MARKER = 'Search backend note (fff):';
const FFF_GUIDANCE =
  '\n\n' +
  FFF_GUIDANCE_MARKER +
  ' this tool is now powered by fff (a fast, typo-resistant file finder) for exact content searches, with ripgrep kept as an automatic fallback. For best results: prefer a single bare identifier over regex or multi-word phrases; results are relevance-ranked so read the top hit first; regex/multiline still work via ripgrep automatically.';

/** [CRITICAL] Repoint the grep→ugrep / find→bfs shadow at the wrapper. */
const repointBashSearchShadow = (
  file: string,
  wrapperPath: string
): string | null => {
  const wp = JSON.stringify(wrapperPath); // a shell-quoted "absolute/path"
  // Idempotent: already repointed (wrapper sits where $_cc_bin was).
  if (
    file.includes(`ARGV0=\${t} ${wp}`) ||
    file.includes(`exec -a \${t} ${wp}`)
  ) {
    return file;
  }
  const count = file.split(SHADOW_TOKEN).length - 1;
  if (count === 0) {
    console.error(
      'patch: swapRipgrepForFff: bash-search shadow anchor "$_cc_bin" not found'
    );
    return null;
  }
  const newFile = file.split(SHADOW_TOKEN).join(wp);
  showDiff(
    file,
    newFile,
    wp,
    file.indexOf(SHADOW_TOKEN),
    file.indexOf(SHADOW_TOKEN) + SHADOW_TOKEN.length
  );
  return newFile;
};

/** [BEST-EFFORT] Repoint the embedded ripgrep resolver descriptor. */
const repointRgResolver = (file: string, wrapperPath: string): string => {
  if (file.includes('--fff-claude-bin=')) return file; // idempotent
  let start = file.indexOf(EMBEDDED_DESCRIPTOR);
  let end = start === -1 ? -1 : start + EMBEDDED_DESCRIPTOR.length;
  if (start === -1) {
    const m = file.match(EMBEDDED_RE);
    if (!m || m.index === undefined) {
      debug(
        'patch: swapRipgrepForFff: ripgrep resolver descriptor not found; skipping rg repoint'
      );
      return file;
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

/** [BEST-EFFORT] Append fff guidance before each Grep-description closing backtick. */
const appendGrepGuidance = (file: string): string => {
  if (file.includes(FFF_GUIDANCE_MARKER)) return file;
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
  // 1. Bash-search shadow (the 40k grep/find path) — CRITICAL.
  const shadowed = repointBashSearchShadow(oldFile, wrapperPath);
  if (shadowed === null) return null;
  let file = shadowed;

  // 2. ripgrep resolver (rare rg + subagent Grep tool) — best-effort.
  file = repointRgResolver(file, wrapperPath);

  // 3. Grep-description guidance (subagents w/ the Grep tool) — best-effort.
  file = appendGrepGuidance(file);

  return file;
};
