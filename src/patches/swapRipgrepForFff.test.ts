import { describe, expect, it, vi } from 'vitest';
import { writeSwapRipgrepForFff } from './swapRipgrepForFff';

const WRAPPER = '/Users/x/.tweakcc/fff/aarch64-apple-darwin/rg-fff';

// Distilled from CC 2.1.186: the embedded ripgrep resolver descriptor.
const DESCRIPTOR =
  '{mode:"embedded",command:process.execPath,args:["--no-config"],argv0:"rg"}';
const RESOLVER = `var sLt=Hn(()=>{if(el(process.env.USE_BUILTIN_RIPGREP)){let n=Own("rg",[]);if(n!=="rg")return{mode:"system",command:n,args:[]}}if(Af()){let n=${DESCRIPTOR};return n}return{mode:"system",command:"rg",args:[]}});`;

// Both Grep description variants as the GY/`xh` gate emits them (concise first,
// full second), plus a resolver descriptor so writeSwapRipgrepForFff runs fully.
const BT = '`';
const GREP_DESC = `;function gVr(e){if(xh(e))return${BT}Content search built on ripgrep. Bare identifiers.${BT};return${BT}A powerful search tool built on ripgrep. Full regex syntax.${BT}}`;
const COMBINED = RESOLVER + GREP_DESC;

describe('swapRipgrepForFff', () => {
  it('repoints the embedded resolver descriptor at the wrapper', () => {
    const out = writeSwapRipgrepForFff(RESOLVER, WRAPPER);
    expect(out).not.toBeNull();
    // embedded descriptor gone, system-mode wrapper descriptor in
    expect(out).not.toContain('mode:"embedded"');
    expect(out).toContain(`command:${JSON.stringify(WRAPPER)}`);
    // live claude path forwarded so the wrapper can re-exec embedded rg
    expect(out).toContain('"--fff-claude-bin="+process.execPath');
    // resolver scaffolding around it is preserved
    expect(out).toContain('USE_BUILTIN_RIPGREP');
    expect(out).toContain('Af()');
  });

  it('is idempotent (no-op when already swapped)', () => {
    const once = writeSwapRipgrepForFff(RESOLVER, WRAPPER)!;
    const twice = writeSwapRipgrepForFff(once, WRAPPER);
    expect(twice).toBe(once);
  });

  it('tolerates arg drift via the regex fallback', () => {
    const drifted = RESOLVER.replace(
      'args:["--no-config"]',
      'args:["--no-config","--threads","1"]'
    );
    const out = writeSwapRipgrepForFff(drifted, WRAPPER);
    expect(out).not.toBeNull();
    expect(out).toContain(`command:${JSON.stringify(WRAPPER)}`);
    expect(out).not.toContain('mode:"embedded"');
  });

  it('returns null when the descriptor is absent', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(writeSwapRipgrepForFff('const x=1;', WRAPPER)).toBeNull();
      expect(errSpy).toHaveBeenCalledWith(
        'patch: swapRipgrepForFff: failed to find embedded ripgrep resolver descriptor'
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it('injects a valid, parseable descriptor object', () => {
    const out = writeSwapRipgrepForFff(RESOLVER, WRAPPER)!;
    // Target OUR injected descriptor (the one carrying the sentinel), not the
    // pre-existing system-mode branches.
    const injected = out.match(
      /\{mode:"system",command:"[^"]*",args:\["--fff-claude-bin="\+process\.execPath\]\}/
    );
    expect(injected).not.toBeNull();
    expect(() =>
      new Function(`const process={execPath:"/x"};return ${injected![0]}`)()
    ).not.toThrow();
  });

  it('appends fff guidance to BOTH grep description variants (GY-agnostic)', () => {
    const out = writeSwapRipgrepForFff(COMBINED, WRAPPER);
    expect(out).not.toBeNull();
    expect(out).toContain('--fff-claude-bin='); // resolver repointed too
    const hits = out!.match(/Search backend note \(fff\):/g) || [];
    expect(hits.length).toBe(2); // concise + full
    expect(out).toContain('Content search built on ripgrep');
    expect(out).toContain('A powerful search tool built on ripgrep');
  });

  it('guidance append is idempotent', () => {
    const once = writeSwapRipgrepForFff(COMBINED, WRAPPER)!;
    const twice = writeSwapRipgrepForFff(once, WRAPPER);
    expect(twice).toBe(once);
  });

  it('no-ops guidance when no grep description present (resolver still repoints)', () => {
    const out = writeSwapRipgrepForFff(RESOLVER, WRAPPER)!;
    expect(out).toContain('--fff-claude-bin=');
    expect(out).not.toContain('Search backend note (fff):');
  });
});
