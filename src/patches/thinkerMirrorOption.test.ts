import { describe, it, expect, vi } from 'vitest';
import { writeThinkerSymbolMirrorOption } from './thinkerMirrorOption';

// CC builds the thinking-spinner frame list by appending the reversed list to
// itself so it "bounces". Two shapes exist in the wild:
//   <= 2.1.238  `=[...VAR,...[...VAR].reverse()]`
//    = 2.1.239  `=[...VAR,...VAR.toReversed()]`
// The patch rewrites either to keep the bounce (enableMirror) or drop it.
const OLD_FIXTURE = 'let $f9=[...$f9,...[...$f9].reverse()],z=2;';
const NEW_FIXTURE = 'let $f9=[...$f9,...$f9.toReversed()],z=2;';
// 2.1.239 ships three variants side by side; all must be rewritten.
const MULTI_FIXTURE =
  'KLw=[...c9l,...c9l.toReversed()],YLw=[...u9l,...u9l.toReversed()],' +
  'RJD=[...IEh,...IEh.toReversed()];';

describe('writeThinkerSymbolMirrorOption', () => {
  for (const [label, fixture] of [
    ['reverse() shape (<= 2.1.238)', OLD_FIXTURE],
    ['toReversed() shape (2.1.239)', NEW_FIXTURE],
  ] as const) {
    it(`keeps the mirrored (bounce) array when enableMirror is true — ${label}`, () => {
      const out = writeThinkerSymbolMirrorOption(fixture, true);
      expect(out).not.toBeNull();
      expect(out).toContain('=[...$f9,...$f9.toReversed()]');
      expect(out).toContain('let $f9=');
      expect(out).toContain(',z=2;');
    });

    it(`drops the mirror when enableMirror is false — ${label}`, () => {
      const out = writeThinkerSymbolMirrorOption(fixture, false);
      expect(out).not.toBeNull();
      expect(out).toContain('=[...$f9]');
      expect(out).not.toContain('.reverse()');
      expect(out).not.toContain('.toReversed()');
      expect(out).toContain(',z=2;');
    });
  }

  // Patching only the first list left the other two bouncing, so which variant
  // the terminal picked decided whether the setting appeared to work at all.
  it('rewrites EVERY frame list, not just the first', () => {
    const out = writeThinkerSymbolMirrorOption(MULTI_FIXTURE, false);
    expect(out).not.toBeNull();
    expect(out).toContain('KLw=[...c9l]');
    expect(out).toContain('YLw=[...u9l]');
    expect(out).toContain('RJD=[...IEh]');
    expect(out).not.toContain('.toReversed()');
  });

  it('returns null (logging) when the mirror shape is absent', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      writeThinkerSymbolMirrorOption('let q=[...a,...b],z=2;', false)
    ).toBeNull();
    errSpy.mockRestore();
  });
});
