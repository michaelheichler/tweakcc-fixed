#!/usr/bin/env node
// Apply-safety ground-truth harness.
//
// Reproduces the REAL `node dist/index.mjs --apply` code path (same
// applySystemPrompts + Unicode-escaping detection + syncPrompt) WITHOUT touching
// the live native binary, and FULLY ISOLATED so it is parallel-safe:
//   - a temp HOME with a COPY of ~/.tweakcc/system-prompts (override set) so
//     syncPrompt's stub creation never races a sibling run or mutates the real
//     override dir;
//   - npm-install mode pointed at a COPY of the pristine cli.js, so the apply
//     patches that copy (no binary repack, no clobber of the user's CC).
//
// Checks (the bar a correct apply-safety fix must hit):
//   - 0 "Could not find" warnings
//   - 0 INTRODUCED minified `${var}` interpolations (vs pristine) — catches the
//     K9-class mis-bind that ReferenceErrors at boot
//   - the patched cli.js still parses
//
// Usage:  node tools/applySafetyHarness.mjs [pristineCliJs]
// Requires a built dist (run `pnpm build` first). Exit 0 = clean.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRISTINE = process.argv[2] || '/tmp/cli-2.1.178.js';
if (!fs.existsSync(PRISTINE)) {
  console.error(`harness: pristine cli.js not found: ${PRISTINE}`);
  process.exit(2);
}
const orig = fs.readFileSync(PRISTINE, 'utf8');

// minified `${var}` tokens: 1-4 alnum/$ chars, not an ALL_CAPS tweakcc name.
const minifiedSlots = (s) => {
  const out = new Map();
  for (const m of s.matchAll(/\$\{([A-Za-z$][\w$]{0,3})\}/g)) {
    const v = m[1];
    if (v === v.toUpperCase() && /[A-Z]/.test(v) && v.length > 2) continue; // skip ALLCAPS names
    out.set(v, (out.get(v) || 0) + 1);
  }
  return out;
};

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'applysafe-home-'));
try {
  // Isolated ~/.tweakcc with a copy of the real override set + config.
  const realTweakcc = path.join(os.homedir(), '.tweakcc');
  const tc = path.join(tmpHome, '.tweakcc');
  fs.mkdirSync(tc, { recursive: true });
  for (const name of ['system-prompts', 'system-reminders']) {
    const src = path.join(realTweakcc, name);
    if (fs.existsSync(src)) {
      fs.cpSync(fs.realpathSync(src), path.join(tc, name), { recursive: true });
    }
  }
  for (const f of ['config.json']) {
    const src = path.join(realTweakcc, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tc, f));
  }

  // npm-install copy of the pristine cli.js.
  const pkgDir = path.join(tmpHome, 'cc', 'node_modules', '@anthropic-ai', 'claude-code');
  fs.mkdirSync(pkgDir, { recursive: true });
  const cliCopy = path.join(pkgDir, 'cli.js');
  fs.copyFileSync(PRISTINE, cliCopy);
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: '@anthropic-ai/claude-code', version: '2.1.178' })
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

  const o = minifiedSlots(orig);
  const p = minifiedSlots(patched);
  const introduced = [];
  for (const [v, n] of p) {
    const base = o.get(v) || 0;
    if (n > base) introduced.push(`${v}(+${n - base})`);
  }

  let parses = true;
  try {
    execFileSync('node', ['--check', cliCopy], { stdio: 'pipe' });
  } catch {
    parses = false;
  }

  console.log('=== apply-safety harness ===');
  console.log(`pristine:          ${PRISTINE}`);
  console.log(`Could not find:    ${cnf}`);
  console.log(`cannot apply safely (warns): ${cannotApply}`);
  console.log(`introduced minified \${var}: ${introduced.length}  ${introduced.slice(0, 12).join(' ')}`);
  console.log(`patched parses:    ${parses}`);
  const ok = cnf === 0 && introduced.length === 0 && parses;
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(ok ? 0 : 1);
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}
