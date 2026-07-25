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

const interpolationSlots = (s, requireUnbound) => {
  const out = [];
  for (const m of s.matchAll(/\$\{([A-Za-z$][\w$]{0,3})\}/g)) {
    const v = m[1];
    if (v === v.toUpperCase() && /[A-Z]/.test(v) && v.length > 2) continue;
    const idx = m.index;
    const window = s.slice(Math.max(0, idx - BIND_WINDOW_BACK), idx + 60);
    if (requireUnbound && bindsInWindow(window, v)) continue;
    out.push({
      name: v,
      fingerprint: s.slice(idx, idx + 80),
    });
  }
  return out;
};

const countSlots = (slots, key) => {
  const out = new Map();
  for (const slot of slots) {
    const value = key(slot);
    out.set(value, (out.get(value) || 0) + 1);
  }
  return out;
};

export const introducedUnresolvedSlots = (orig, patched) => {
  const originalDangerous = interpolationSlots(orig, true);
  const patchedDangerous = interpolationSlots(patched, true);
  const o = countSlots(originalDangerous, slot => slot.name);
  const p = countSlots(patchedDangerous, slot => slot.name);
  const originalFingerprints = countSlots(
    interpolationSlots(orig, false),
    slot => `${slot.name}\0${slot.fingerprint}`
  );
  const originalDangerousFingerprints = countSlots(
    originalDangerous,
    slot => `${slot.name}\0${slot.fingerprint}`
  );
  const patchedDangerousFingerprints = countSlots(
    patchedDangerous,
    slot => `${slot.name}\0${slot.fingerprint}`
  );
  const out = new Map();
  for (const [v, n] of p) {
    let reclassified = 0;
    for (const [fingerprint, count] of patchedDangerousFingerprints) {
      if (!fingerprint.startsWith(`${v}\0`)) continue;
      reclassified +=
        Math.min(count, originalFingerprints.get(fingerprint) || 0) -
        Math.min(count, originalDangerousFingerprints.get(fingerprint) || 0);
    }
    const delta = n - (o.get(v) || 0) - reclassified;
    if (delta > 0) out.set(v, delta);
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

export const harnessVerdict = ({
  cnf,
  cannotApply,
  introduced,
  rawNonAscii,
  parses,
  wfScriptErrors,
}) =>
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
  for (const f of ['config.json']) {
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
  try {
    log = execFileSync('node', [path.join(REPO, 'dist', 'index.mjs'), '--apply'], {
      env: { ...process.env, HOME: tmpHome, TWEAKCC_CC_INSTALLATION_PATH: cliCopy },
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    log = (e.stdout || '') + (e.stderr || '');
  }

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
  console.log(`Could not find:    ${cnf}`);
  console.log(`cannot apply safely (warns): ${cannotApply}`);
  console.log(`introduced minified \${var}: ${introduced.length}  ${introduced.slice(0, 12).join(' ')}`);
  console.log(`introduced raw non-ASCII: ${rawNonAscii.length}  ${rawNonAscii.slice(0, 12).join(' ')}`);
  console.log(`patched parses:    ${parses}  [${parseMode}]`);
  console.log(`workflow-script JS: ${wfScriptErrors.length === 0 ? 'ok' : wfScriptErrors.join(' | ')}`);
  const ok = harnessVerdict({
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
