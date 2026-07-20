import { describe, expect, it } from 'vitest';
import {
  harnessVerdict,
  introducedRawNonAscii,
} from './applySafetyHarness.mjs';

const clean = {
  cnf: 0,
  cannotApply: 0,
  introduced: [],
  rawNonAscii: [],
  parses: true,
  wfScriptErrors: [],
};

describe('applySafetyHarness: harnessVerdict', () => {
  it('passes only when every check is clean', () => {
    expect(harnessVerdict(clean)).toBe(true);
  });

  it('fails on a "cannot apply safely" warning', () => {
    expect(harnessVerdict({ ...clean, cannotApply: 1 })).toBe(false);
  });

  it('fails on introduced raw non-ASCII', () => {
    expect(harnessVerdict({ ...clean, rawNonAscii: ['U+2014(+1)'] })).toBe(
      false
    );
  });

  it('still fails on the pre-existing checks', () => {
    expect(harnessVerdict({ ...clean, cnf: 1 })).toBe(false);
    expect(harnessVerdict({ ...clean, introduced: ['K9(+1)'] })).toBe(false);
    expect(harnessVerdict({ ...clean, parses: false })).toBe(false);
    expect(harnessVerdict({ ...clean, wfScriptErrors: ['x.md: boom'] })).toBe(
      false
    );
  });
});

// Every injection surface escapes non-ASCII to \uXXXX before splicing; a raw
// codepoint that survives into the patched binary mojibakes under Bun's Latin-1
// module storage (2.0.13 incident). The check is a per-codepoint DELTA so the
// pristine's own non-ASCII can never trip it.
describe('applySafetyHarness: introducedRawNonAscii', () => {
  it('reports nothing when the patch escaped its non-ASCII', () => {
    const pristine = 'x=`use a — dash`;';
    const patched = 'x=`use a \\u2014 dash`;';
    expect(introducedRawNonAscii(pristine, patched)).toEqual([]);
  });

  it('reports nothing when patched and pristine are identical', () => {
    const s = 'x=`“quoted” — ✓`;';
    expect(introducedRawNonAscii(s, s)).toEqual([]);
  });

  it('does not flag pristine non-ASCII that merely moved', () => {
    const pristine = 'a=`— ✓`;b=`plain`;';
    const patched = 'a=`plain`;b=`✓ —`;';
    expect(introducedRawNonAscii(pristine, patched)).toEqual([]);
  });

  it('does not flag a patch that REMOVES non-ASCII', () => {
    const pristine = 'x=`— — ✓`;';
    const patched = 'x=`—`;';
    expect(introducedRawNonAscii(pristine, patched)).toEqual([]);
  });

  it('flags a raw non-ASCII codepoint the patch introduced', () => {
    const pristine = 'x=`plain ascii`;';
    const patched = 'x=`plain — ascii`;';
    expect(introducedRawNonAscii(pristine, patched)).toEqual(['U+2014(+1)']);
  });

  it('counts only the surplus when pristine already carried the codepoint', () => {
    const pristine = 'x=`—`;';
    const patched = 'x=`— — —`;';
    expect(introducedRawNonAscii(pristine, patched)).toEqual(['U+2014(+2)']);
  });

  it('reports each introduced codepoint, sorted', () => {
    const pristine = 'x=`ascii`;';
    const patched = 'x=`— ✓`;';
    expect(introducedRawNonAscii(pristine, patched)).toEqual([
      'U+2014(+1)',
      'U+2713(+1)',
    ]);
  });

  it('handles astral codepoints as single units', () => {
    const pristine = 'x=`ascii`;';
    const patched = 'x=`\u{1F600}`;';
    expect(introducedRawNonAscii(pristine, patched)).toEqual(['U+1F600(+1)']);
  });

  it('ignores ASCII-only differences entirely', () => {
    expect(introducedRawNonAscii('abc', 'abc def \n\t')).toEqual([]);
  });
});
