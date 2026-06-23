import { describe, expect, it, vi } from 'vitest';
import { writeSwapRipgrepForFff } from './swapRipgrepForFff';

const WRAPPER = '/Users/x/.tweakcc/fff/aarch64-apple-darwin/rg-fff';
const WQ = JSON.stringify(WRAPPER); // "..."

// The grep/find shadow template as CC's snapshot-generator emits it (3× "$_cc_bin").
const SHADOW =
  'function grep {\n' +
  '  local _cc_bin="${CLAUDE_CODE_EXECPATH:-}"\n' +
  '  [[ -x $_cc_bin ]] || _cc_bin=/Users/x/.local/bin/claude\n' +
  '  if [[ ! -x $_cc_bin ]]; then command grep "$@"; return; fi\n' +
  '  if [[ -n "${ZSH_VERSION:-}" ]]; then\n' +
  '    ARGV0=${t} "$_cc_bin" ${o}\n' +
  '  elif [[ "$OSTYPE" == "msys" ]]; then\n' +
  '    ARGV0=${t} "$_cc_bin" ${o}\n' +
  '  else\n' +
  '    (exec -a ${t} "$_cc_bin" ${o})\n' +
  '  fi\n}';

const DESCRIPTOR =
  '{mode:"embedded",command:process.execPath,args:["--no-config"],argv0:"rg"}';
const RESOLVER = `if(Af()){let n=${DESCRIPTOR};return n}`;

const BT = '`';
const GREP_DESC = `;function gVr(e){if(xh(e))return${BT}Content search built on ripgrep. Bare identifiers.${BT};return${BT}A powerful search tool built on ripgrep. Full regex syntax.${BT}}`;

const COMBINED = SHADOW + RESOLVER + GREP_DESC;

const countOf = (s: string, sub: string) => s.split(sub).length - 1;

describe('swapRipgrepForFff', () => {
  it('repoints all 3 bash-search shadow sites at the wrapper', () => {
    const out = writeSwapRipgrepForFff(COMBINED, WRAPPER);
    expect(out).not.toBeNull();
    expect(out).not.toContain('"$_cc_bin"');
    // wrapper appears 3× (shadow) + 1× (rg resolver) = 4
    expect(countOf(out!, WRAPPER)).toBeGreaterThanOrEqual(4);
    expect(out).toContain('ARGV0=${t} ' + WQ);
    expect(out).toContain('exec -a ${t} ' + WQ);
  });

  it('also repoints the rg resolver and appends fff guidance to both grep variants', () => {
    const out = writeSwapRipgrepForFff(COMBINED, WRAPPER)!;
    expect(out).toContain('--fff-claude-bin='); // rg resolver
    expect(out).not.toContain('mode:"embedded"');
    expect(countOf(out, 'Search backend note (fff):')).toBe(2); // concise + full
  });

  it('is idempotent (no-op when already applied)', () => {
    const once = writeSwapRipgrepForFff(COMBINED, WRAPPER)!;
    const twice = writeSwapRipgrepForFff(once, WRAPPER);
    expect(twice).toBe(once);
  });

  it('succeeds on a shadow-only file (rg/guidance are best-effort)', () => {
    const out = writeSwapRipgrepForFff(SHADOW, WRAPPER);
    expect(out).not.toBeNull();
    expect(out).not.toContain('"$_cc_bin"');
    expect(countOf(out!, WRAPPER)).toBe(3);
  });

  it('returns null (critical) when the shadow anchor is absent', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // RESOLVER alone has no "$_cc_bin" shadow token.
      expect(writeSwapRipgrepForFff(RESOLVER, WRAPPER)).toBeNull();
      expect(errSpy).toHaveBeenCalledWith(
        'patch: swapRipgrepForFff: bash-search shadow anchor "$_cc_bin" not found'
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it('injects shell-valid wrapper paths (quoted)', () => {
    const out = writeSwapRipgrepForFff(SHADOW, WRAPPER)!;
    // each repointed invocation is ARGV0=${t} "<path>" ${o} or exec -a ${t} "<path>" ${o}
    expect(out).toContain('ARGV0=${t} ' + WQ + ' ${o}');
    expect(out).toContain('(exec -a ${t} ' + WQ + ' ${o})');
  });
});
