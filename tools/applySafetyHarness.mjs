#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--set='));
const PRISTINE = argv[0] || '/tmp/cli-2.1.179.js';
const OVERRIDE_SET =
  (process.argv.find((a) => a.startsWith('--set=')) || '').slice(6) ||
  process.env.TWEAKCC_OVERRIDE_SET ||
  null;
const VERSION =
  (PRISTINE.match(/cli-(\d+\.\d+\.\d+)\.js$/) || [, '2.1.179'])[1];

const bindsInWindow = (window, v) => {
  const re = new RegExp(
    `(?:\\b(?:let|const|var|function)\\s+|(?<!\\$)[([,{]\\s*)${v.replace(/[$]/g, '\\$&')}(?=\\s*(?:[)\\]},=:]|=>))`
  );
  return re.test(window);
};

const BIND_WINDOW_BACK = 1500;

// "Dangerous" `${v}` slots in `s`: short-ident interpolations whose `v` is NOT
// bound in the slot's OWN enclosing window (arrow/params before the template body,
// or a `let v=` just before its `${v}`). A slot bound in its own window is a plain
// local in emitted code — it parses and never ReferenceErrors, so it is never
// dangerous, in pristine OR patched.
// Second-chance lookback. Minified module consts are emitted as one long
// comma-declarator chain inside a `var X=T(()=>{…})` IIFE, so a use and its
// declaration can sit tens of KB apart in the SAME statement. An override that
// legitimately expands a neighbouring const in that chain pushes the declaration
// past BIND_WINDOW_BACK, and the slot then reads as newly dangerous although the
// name is still declared in scope and the file still parses — 2.1.232 flagged
// `${xJh}`/`${RJh}` in all four sets exactly this way. So when the narrow window
// misses, look much further back for a DECLARATION of that specific name. A name
// declared nowhere within reach — the real leak this gate exists to find — still
// flags, because this only ever searches for that one identifier.
const DECL_WINDOW_BACK = 200_000;
const declaredFurtherBack = (s, idx, v) => {
  const from = Math.max(0, idx - DECL_WINDOW_BACK);
  const window = s.slice(from, idx);
  const esc = v.replace(/[$]/g, '\\$&');
  return new RegExp(
    `(?:\\b(?:let|const|var|function)\\s+|(?<!\\$)[([,{;]\\s*)${esc}\\s*(?:=[^=>]|[)\\]},:]|=>)`
  ).test(window);
};

// Every short-ident `${v}` interpolation in `s`, unfiltered — the fingerprint
// reclassification below needs the full population (dangerous or not) from the
// pristine side to tell "this exact site already existed" from "the patch wrote
// a new one that happens to share a name".
const allSlots = (s) => {
  const out = [];
  for (const m of s.matchAll(/\$\{([A-Za-z$][\w$]{0,3})\}/g)) {
    const v = m[1];
    if (v === v.toUpperCase() && /[A-Z]/.test(v) && v.length > 2) continue;
    out.push({ name: v, idx: m.index, fingerprint: s.slice(m.index, m.index + 80) });
  }
  return out;
};

const isDangerous = (s, slot) => {
  const window = s.slice(Math.max(0, slot.idx - BIND_WINDOW_BACK), slot.idx + 60);
  if (bindsInWindow(window, slot.name)) return false; // bound local — safe
  if (declaredFurtherBack(s, slot.idx, slot.name)) return false; // module const further up the same chain
  return true;
};

const countBy = (items, key) => {
  const out = new Map();
  for (const item of items) {
    const k = key(item);
    out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
};

// K9-class UNRESOLVED binary idents the PATCH introduced. The bind-discount MUST be
// scoped to each slot's own enclosing template literal, not counted file-wide: `q`,
// `e`, `t` are common minified names, so a whole-file binding delta nets out and
// either hides a real leak or (2.1.218) cries wolf on a legitimately-bound `${q}`
// like `Object.entries(t).map(([q,K])=>`# ${q}\n${K}`)`. We instead net-count the
// DANGEROUS (unbound-in-window, undeclared-further-back) slots per var: a var is
// introduced-unresolved only where patched has more dangerous `${v}` slots than
// pristine did, after subtracting sites that merely RECLASSIFIED (same site, same
// name, same 80-char forward text, present in pristine at all — dangerous or not —
// but only newly dangerous in patched because the binding shifted out of reach).
// Net-counting and reclassification both stay robust to the byte shifts
// minification/override edits cause everywhere.
// Neither is enough alone. An override splice upstream of an UNTOUCHED site shifts
// that site's bytes, and a shift can push a legitimate binding out of both
// BIND_WINDOW_BACK and DECL_WINDOW_BACK, or off its exact fingerprint offset
// (2.1.224: `${w}` in the artifact-comments header, whose `w=mr(e.threads,T)` sits
// 3,040 chars back). So a dangerous slot in patched is only INTRODUCED when its
// surrounding text is text the patch actually wrote: if the same context appears
// verbatim in the pristine, the patch did not author it, whatever its offset
// became.
const CONTEXT_BACK = 120;
const CONTEXT_FWD = 120;
const contextKey = (s, idx) =>
  s.slice(Math.max(0, idx - CONTEXT_BACK), idx + CONTEXT_FWD);

export const introducedUnresolvedSlots = (orig, patched) => {
  const origAll = allSlots(orig);
  const patchedAll = allSlots(patched);
  const origDangerous = origAll.filter((slot) => isDangerous(orig, slot));
  const patchedDangerous = patchedAll.filter((slot) =>
    isDangerous(patched, slot)
  );

  const o = countBy(origDangerous, (slot) => slot.name);
  const p = countBy(patchedDangerous, (slot) => slot.name);
  const origFingerprints = countBy(
    origAll,
    (slot) => `${slot.name}\0${slot.fingerprint}`
  );
  const origDangerousFingerprints = countBy(
    origDangerous,
    (slot) => `${slot.name}\0${slot.fingerprint}`
  );
  const patchedDangerousFingerprints = countBy(
    patchedDangerous,
    (slot) => `${slot.name}\0${slot.fingerprint}`
  );

  const out = new Map();
  for (const [v, n] of p) {
    let reclassified = 0;
    for (const [fingerprint, count] of patchedDangerousFingerprints) {
      if (!fingerprint.startsWith(`${v}\0`)) continue;
      reclassified +=
        Math.min(count, origFingerprints.get(fingerprint) || 0) -
        Math.min(count, origDangerousFingerprints.get(fingerprint) || 0);
    }
    const delta = n - (o.get(v) || 0) - reclassified;
    if (delta <= 0) continue;
    // Keep only the slots whose own context is absent from the pristine.
    const positions = patchedDangerous
      .filter((slot) => slot.name === v)
      .map((slot) => slot.idx);
    const authored = positions.filter(
      (idx) => !orig.includes(contextKey(patched, idx))
    ).length;
    const real = Math.min(delta, authored);
    if (real > 0) out.set(v, real);
  }
  return out;
};

export const introducedRawNonAscii = (pristine, patched) => {
  const census = (s) => {
    const out = new Map();
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp < 0x80) continue;
      out.set(cp, (out.get(cp) || 0) + 1);
    }
    return out;
  };
  const o = census(pristine);
  const p = census(patched);
  const out = [];
  for (const [cp, n] of p) {
    const delta = n - (o.get(cp) || 0);
    if (delta > 0) {
      out.push(
        `U+${cp.toString(16).toUpperCase().padStart(4, '0')}(+${delta})`
      );
    }
  }
  return out.sort();
};

// A "cannot apply safely" warning means an override was NOT spliced — the
// operator's content is missing from the binary. Counting it without gating on
// it reported PASS for a half-applied set, so it is a failure like the rest.
//
// `applyOk` gates on the apply having actually RUN. Every other signal here is
// derived from the patched file, and a crashed apply leaves that file identical
// to pristine — which satisfies all of them trivially. That is a false PASS, and
// it happened: a fable-5 override with an over-escaped template-literal delimiter
// killed `applyIdentifierMapping` with `unbalanced ${...} interpolation`, nothing
// was written, and the harness reported PASS for a set that applied NOTHING.
// A run that could not complete must be as loud as one that completed wrong.
export const harnessVerdict = ({
  applyOk,
  cnf,
  cannotApply,
  introduced,
  rawNonAscii,
  parses,
  wfScriptErrors,
}) =>
  applyOk !== false &&
  cnf === 0 &&
  cannotApply === 0 &&
  introduced.length === 0 &&
  rawNonAscii.length === 0 &&
  parses &&
  wfScriptErrors.length === 0;

const runHarness = () => {
if (!fs.existsSync(PRISTINE)) {
  console.error(`harness: pristine cli.js not found: ${PRISTINE}`);
  process.exit(2);
}
const orig = fs.readFileSync(PRISTINE, 'utf8');
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'applysafe-home-'));
try {
  const realTweakcc = path.join(os.homedir(), '.tweakcc');
  const tc = path.join(tmpHome, '.tweakcc');
  fs.mkdirSync(tc, { recursive: true });
  for (const name of ['system-prompts', 'system-reminders']) {
    const src =
      name === 'system-prompts' && OVERRIDE_SET
        ? OVERRIDE_SET
        : path.join(realTweakcc, name);
    if (fs.existsSync(src)) {
      fs.cpSync(fs.realpathSync(src), path.join(tc, name), { recursive: true });
    }
  }
  // systemPromptOriginalHashes.json is the baseline index syncPrompt reads to tell
  // "user edited this override" from "pristine moved under it". Omitting it does not
  // merely change the conflict REPORT — it changes what gets spliced, so the harness
  // grades a binary a real apply never produces. On 2.1.227 that was the whole of the
  // long-standing fable-5 `introduced ${n}: 1`: with the baseline the same set is
  // clean, without it the apply emits a 28KB-different bundle carrying an `${n}` in
  // override text. A ground-truth harness has to reproduce the real code path, and
  // the driver's own sandboxedApply already copies both files for this reason.
  for (const f of ['config.json', 'systemPromptOriginalHashes.json']) {
    const src = path.join(realTweakcc, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tc, f));
  }

  const pkgDir = path.join(tmpHome, 'cc', 'node_modules', '@anthropic-ai', 'claude-code');
  fs.mkdirSync(pkgDir, { recursive: true });
  const cliCopy = path.join(pkgDir, 'cli.js');
  fs.copyFileSync(PRISTINE, cliCopy);
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: '@anthropic-ai/claude-code', version: VERSION })
  );

  let log = '';
  let applyExit = 0;
  try {
    log = execFileSync('node', [path.join(REPO, 'dist', 'index.mjs'), '--apply'], {
      env: { ...process.env, HOME: tmpHome, TWEAKCC_CC_INSTALLATION_PATH: cliCopy },
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    log = (e.stdout || '') + (e.stderr || '');
    applyExit = e.status ?? 1;
  }
  // Positive marker + exit code: absence of error lines is not evidence the
  // apply ran. See the note on harnessVerdict.
  const applyOk =
    applyExit === 0 && /Customizations applied/.test(log);

  const patched = fs.readFileSync(cliCopy, 'utf8');
  const cnf = (log.match(/Could not find/g) || []).length;
  const cannotApply = (log.match(/cannot apply safely/gi) || []).length;

  const introduced = [];
  for (const [v, n] of introducedUnresolvedSlots(orig, patched)) {
    introduced.push(`${v}(+${n})`);
  }

  const rawNonAscii = introducedRawNonAscii(orig, patched);

  const firstSyntaxError = (file, bin, flags) => {
    try {
      execFileSync(bin, [...flags, '--check', file], { stdio: 'pipe' });
      return null; // parsed clean
    } catch (e) {
      const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
      const m = out.match(/SyntaxError:.*/);
      return m ? m[0] : `EXIT_${e.status ?? 'ERR'}`;
    }
  };

  const candidateNodes = [];
  const seen = new Set();
  const addNode = (bin) => {
    if (bin && !seen.has(bin) && fs.existsSync(bin)) {
      seen.add(bin);
      candidateNodes.push(bin);
    }
  };
  addNode('node');
  addNode(process.execPath);
  const versionDirs = [];
  for (const root of [
    path.join(os.homedir(), '.local', 'share', 'mise', 'installs', 'node'),
    path.join(os.homedir(), '.nvm', 'versions', 'node'),
    path.join(os.homedir(), '.local', 'share', 'fnm', 'node-versions'),
  ]) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(root);
    } catch {
      dirs = [];
    }
    for (const d of dirs) {
      versionDirs.push(path.join(root, d));
    }
  }
  versionDirs.sort().reverse();
  for (const d of versionDirs) {
    addNode(path.join(d, 'bin', 'node'));
    addNode(path.join(d, 'installation', 'bin', 'node'));
  }

  const checkers = [];
  for (const bin of candidateNodes) {
    checkers.push({ bin, flags: [] });
    checkers.push({ bin, flags: ['--js-explicit-resource-management'] });
  }

  let parses;
  let parseMode = 'none';
  const capable = checkers.find(
    c => firstSyntaxError(PRISTINE, c.bin, c.flags) === null
  );
  if (capable) {
    parses = firstSyntaxError(cliCopy, capable.bin, capable.flags) === null;
    parseMode = `${capable.bin}${capable.flags.length ? ' ' + capable.flags.join(' ') : ''}`;
  } else {
    const base = firstSyntaxError(PRISTINE, 'node', []);
    const got = firstSyntaxError(cliCopy, 'node', []);
    parses = base === got;
    parseMode = `equivalence(node): pristine=${base} patched=${got}`;
  }

  const wfScriptErrors = [];
  const spDir = path.join(tc, 'system-prompts');
  let wfFiles = [];
  try {
    wfFiles = fs
      .readdirSync(spDir)
      .filter(f => /^workflow-script-.*\.md$/.test(f));
  } catch {
    wfFiles = [];
  }
  for (const f of wfFiles) {
    const body = fs
      .readFileSync(path.join(spDir, f), 'utf8')
      .replace(/^<!--[\s\S]*?-->\n?/, '');
    if (!body.trim()) continue;
    const js = body
      .replace(/\$\{[^{}]*\}/g, '(null)')
      .replace(/\\\\/g, '\\')
      .replace(/^export /m, '');
    const wrapped = path.join(tmpHome, `wfcheck-${f}.js`);
    fs.writeFileSync(wrapped, `async function __f(){\n${js}\n}`);
    const err = firstSyntaxError(wrapped, 'node', []);
    if (err) wfScriptErrors.push(`${f}: ${err}`);
  }

  console.log('=== apply-safety harness ===');
  console.log(`pristine:          ${PRISTINE}`);
  console.log(`apply ran:         ${applyOk}${applyOk ? '' : `  (exit ${applyExit}${/unbalanced|Error/.test(log) ? ', ' + (log.match(/^.*(?:Error|unbalanced).*$/m) || [''])[0].slice(0, 120) : ''})`}`);
  console.log(`Could not find:    ${cnf}`);
  // Naming them is the whole point when this runs as the cross-platform gate:
  // a bare count tells you a one-platform prompt exists but not which one, and
  // the bundle it failed against is a temp file that is gone by the time you
  // think to look.
  for (const line of log.split('\n').filter((l) => /Could not find/.test(l)))
    console.log(`  ${line.trim()}`);
  console.log(`cannot apply safely (warns): ${cannotApply}`);
  console.log(`introduced minified \${var}: ${introduced.length}  ${introduced.slice(0, 12).join(' ')}`);
  console.log(`introduced raw non-ASCII: ${rawNonAscii.length}  ${rawNonAscii.slice(0, 12).join(' ')}`);
  console.log(`patched parses:    ${parses}  [${parseMode}]`);
  console.log(`workflow-script JS: ${wfScriptErrors.length === 0 ? 'ok' : wfScriptErrors.join(' | ')}`);
  const ok = harnessVerdict({
    applyOk,
    cnf,
    cannotApply,
    introduced,
    rawNonAscii,
    parses,
    wfScriptErrors,
  });
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(ok ? 0 : 1);
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}
};

const realpath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const invokedDirectly =
  !!process.argv[1] &&
  realpath(process.argv[1]) === realpath(fileURLToPath(import.meta.url));
if (invokedDirectly) runHarness();
