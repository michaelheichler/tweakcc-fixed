import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as promptSync from '../systemPromptSync';

beforeEach(() => {
  vi.clearAllMocks();
});
describe('escapeDepthZeroBackticks basic cases', () => {
  it('should escape depth-0 backticks', () => {
    const input = 'Use `code` here';
    const expected = 'Use \\`code\\` here';
    expect(promptSync.escapeDepthZeroBackticks(input).content).toBe(expected);
  });

  it('should not double-escape already-escaped backticks', () => {
    const input = 'Use \\`code\\` here';
    expect(promptSync.escapeDepthZeroBackticks(input).content).toBe(input);
  });

  it('should preserve backticks inside ${...} interpolations', () => {
    const input = '${cond?`a`:`b`}';
    expect(promptSync.escapeDepthZeroBackticks(input).content).toBe(input);
  });

  it('should escape depth-0 backticks but preserve interpolation backticks', () => {
    const input = 'Use `x` and ${c?`a`:`b`}';
    const expected = 'Use \\`x\\` and ${c?`a`:`b`}';
    expect(promptSync.escapeDepthZeroBackticks(input).content).toBe(expected);
  });

  it('should preserve backticks inside nested braces in interpolation', () => {
    const input = '${fn({k:`v`})}';
    expect(promptSync.escapeDepthZeroBackticks(input).content).toBe(input);
  });

  it('should escape consecutive backticks', () => {
    const input = '```code```';
    const expected = '\\`\\`\\`code\\`\\`\\`';
    expect(promptSync.escapeDepthZeroBackticks(input).content).toBe(expected);
  });

  it('should return empty string for empty input', () => {
    expect(promptSync.escapeDepthZeroBackticks('').content).toBe('');
  });

  it('should return input unchanged when no backticks present', () => {
    const input = 'plain text with no backticks';
    expect(promptSync.escapeDepthZeroBackticks(input).content).toBe(input);
  });

  it('should escape backtick after escaped backslash (REGEX-001 fixed)', () => {
    const input = 'text\\\\`more';
    expect(promptSync.escapeDepthZeroBackticks(input).content).toBe(
      'text\\\\\\`more'
    );
  });
});
describe('escapeDepthZeroBackticks nested cases', () => {
  it('should not escape backtick after odd number of backslashes', () => {
    const input = 'text\\\\\\`more';
    expect(promptSync.escapeDepthZeroBackticks(input).content).toBe(input);
  });

  it('should handle unclosed interpolation gracefully (SFH-002)', () => {
    const input = '`pre` ${unclosed `backtick`';
    const result = promptSync.escapeDepthZeroBackticks(input);
    expect(result.content).toBe('\\`pre\\` ${unclosed `backtick`');
    expect(result.incomplete).toBe(true);
  });

  it('should escape backtick immediately after interpolation close', () => {
    expect(promptSync.escapeDepthZeroBackticks('${x}`y`').content).toBe(
      '${x}\\`y\\`'
    );
  });

  it('should escape depth-0 backticks across multiple lines', () => {
    const input = 'line1 `a`\nline2 `b`\nline3 ${x?`c`:`d`}';
    const result = promptSync.escapeDepthZeroBackticks(input);
    expect(result.content).toBe(
      'line1 \\`a\\`\nline2 \\`b\\`\nline3 ${x?`c`:`d`}'
    );
    expect(result.incomplete).toBe(false);
  });

  it('should not let } inside nested template literal close the interpolation (SFHPFV-003)', () => {
    const input = 'Use `x` and ${cond?`}`:`other`}';
    const result = promptSync.escapeDepthZeroBackticks(input);
    expect(result.content).toBe('Use \\`x\\` and ${cond?`}`:`other`}');
    expect(result.incomplete).toBe(false);
  });

  it('should not treat escaped \\${ as interpolation start at depth 0 (INTERP-001)', () => {
    const input = 'text \\${ `code`';
    const result = promptSync.escapeDepthZeroBackticks(input);
    expect(result.content).toBe('text \\${ \\`code\\`');
    expect(result.incomplete).toBe(false);
  });

  it('should not treat escaped \\${ inside interpolation as nested (INTERP-002)', () => {
    const input = '${a \\${b} `code`';
    const result = promptSync.escapeDepthZeroBackticks(input);
    expect(result.content).toBe('${a \\${b} \\`code\\`');
    expect(result.incomplete).toBe(false);
  });

  it('should not treat escaped \\${ inside template in interpolation (INTERP-003)', () => {
    const input = '${a?`text \\${ more`:`other`} `code`';
    const result = promptSync.escapeDepthZeroBackticks(input);
    expect(result.content).toBe('${a?`text \\${ more`:`other`} \\`code\\`');
    expect(result.incomplete).toBe(false);
  });

  it('should handle deeply nested template literals in interpolations', () => {
    const input = '${a?`${b?`deep`:`also`}`:`flat`}';
    const result = promptSync.escapeDepthZeroBackticks(input);
    expect(result.content).toBe(input);
    expect(result.incomplete).toBe(false);
  });
});
const map = (content: string, pairs: Array<[string, string]>): string =>
  promptSync.applyIdentifierMapping(
    content,
    pairs.map((_, i) => i),
    Object.fromEntries(pairs.map(([human], i) => [String(i), human])),
    pairs.map(([, minified]) => minified),
    '1.0.0'
  );
describe('applyIdentifierMapping expression cases', () => {
  it('leaves a label appearing in prose byte-for-byte unchanged', () => {
    const content = 'Use `$CLAUDE_JOB_DIR/tmp` for temporary files.';
    expect(map(content, [['CLAUDE_JOB_DIR', '$e']])).toBe(content);
  });

  it('leaves a bare label in prose unchanged even mid-sentence', () => {
    const content = 'The CLAUDE_JOB_DIR variable points at the job directory.';
    expect(map(content, [['CLAUDE_JOB_DIR', '$e']])).toBe(content);
  });

  it('maps every identifier inside a call expression', () => {
    const content = '${PATH_MODULE.join(CLAUDE_JOB_DIR,"tmp")}';
    expect(
      map(content, [
        ['PATH_MODULE', 'q1'],
        ['CLAUDE_JOB_DIR', '$e'],
      ])
    ).toBe('${q1.join($e,"tmp")}');
  });

  it('maps a label nested inside a call argument', () => {
    const content = 'Ladder: ${JSON.stringify(VERDICT_LADDER)}';
    expect(map(content, [['VERDICT_LADDER', 'Xy2']])).toBe(
      'Ladder: ${JSON.stringify(Xy2)}'
    );
  });

  it('leaves a code-looking line outside any interpolation unchanged', () => {
    const content = 'const VERDICT_LADDER = ["a","b"];';
    expect(map(content, [['VERDICT_LADDER', 'Xy2']])).toBe(content);
  });

  it('does not map a label inside a string literal in an expression', () => {
    const content = '${f("CLAUDE_JOB_DIR")}';
    expect(map(content, [['CLAUDE_JOB_DIR', '$e']])).toBe(content);
  });

  it('does not map a label inside a single-quoted string', () => {
    const content = "${f('CLAUDE_JOB_DIR')+CLAUDE_JOB_DIR}";
    expect(map(content, [['CLAUDE_JOB_DIR', '$e']])).toBe(
      "${f('CLAUDE_JOB_DIR')+$e}"
    );
  });

  it('maps both computed and property-position labels', () => {
    expect(map('${o[CLAUDE_JOB_DIR]}', [['CLAUDE_JOB_DIR', '$e']])).toBe(
      '${o[$e]}'
    );
    expect(map('${o.CLAUDE_JOB_DIR}', [['CLAUDE_JOB_DIR', '$e']])).toBe(
      '${o.$e}'
    );
  });
});
describe('applyIdentifierMapping generated slots', () => {
  it('round-trips an optional-chained slot generated from pieces', () => {
    const pieces = [
      'This conversation was forked out of ${',
      '?.',
      '??',
      '()}.',
    ];
    const identifiers = [0, 1, 2];
    const identifierMap = { '0': 'VAR_0', '1': 'VAR_1', '2': 'VAR_2' };
    const generated = promptSync.reconstructContentFromPieces(
      pieces,
      identifiers,
      identifierMap
    );
    expect(generated).toContain('${VAR_0?.VAR_1??VAR_2()}');

    const applied = promptSync.applyIdentifierMapping(
      generated,
      identifiers,
      identifierMap,
      ['z0', 'displayName', 'z2'],
      '1.0.0'
    );
    expect(applied).toBe(
      'This conversation was forked out of ${z0?.displayName??z2()}.'
    );
  });

  it('does not map an object-literal key but does map its value', () => {
    const content = '${JSON.stringify({CLAUDE_JOB_DIR: CLAUDE_JOB_DIR})}';
    expect(map(content, [['CLAUDE_JOB_DIR', '$e']])).toBe(
      '${JSON.stringify({CLAUDE_JOB_DIR: $e})}'
    );
  });

  it('maps a spread of the binding', () => {
    expect(map('${f(...VERDICT_LADDER)}', [['VERDICT_LADDER', 'Xy2']])).toBe(
      '${f(...Xy2)}'
    );
  });

  it('leaves an escaped \\${LABEL} entirely alone', () => {
    const content = 'Literal \\${CLAUDE_JOB_DIR} stays put.';
    expect(map(content, [['CLAUDE_JOB_DIR', '$e']])).toBe(content);
  });

  it('throws on an unbalanced ${', () => {
    expect(() =>
      map('Broken ${CLAUDE_JOB_DIR', [['CLAUDE_JOB_DIR', '$e']])
    ).toThrow(/unbalanced/);
  });

  it('throws on an interpolation closed only inside a string literal', () => {
    expect(() => map('${f("}")', [['CLAUDE_JOB_DIR', '$e']])).toThrow(
      /unbalanced/
    );
  });
});
describe('applyIdentifierMapping lexical edge cases', () => {
  it('maps inside a nested template literal expression', () => {
    const content = '${a?`dir ${CLAUDE_JOB_DIR}`:`none`}';
    expect(map(content, [['CLAUDE_JOB_DIR', '$e']])).toBe(
      '${a?`dir ${$e}`:`none`}'
    );
  });

  it('does not map template-literal text between interpolations', () => {
    const content = '${a?`CLAUDE_JOB_DIR ${CLAUDE_JOB_DIR}`:``}';
    expect(map(content, [['CLAUDE_JOB_DIR', '$e']])).toBe(
      '${a?`CLAUDE_JOB_DIR ${$e}`:``}'
    );
  });

  it('does not map inside a comment within an expression', () => {
    const content = '${/* CLAUDE_JOB_DIR */ CLAUDE_JOB_DIR}';
    expect(map(content, [['CLAUDE_JOB_DIR', '$e']])).toBe(
      '${/* CLAUDE_JOB_DIR */ $e}'
    );
  });

  it('does not map inside a regex literal within an expression', () => {
    const content = '${s.replace(/CLAUDE_JOB_DIR/g,CLAUDE_JOB_DIR)}';
    expect(map(content, [['CLAUDE_JOB_DIR', '$e']])).toBe(
      '${s.replace(/CLAUDE_JOB_DIR/g,$e)}'
    );
  });

  it('treats a slash after an identifier as division, not a regex', () => {
    const content = '${TOTAL_BUDGET/2} and ${TOTAL_BUDGET}';
    expect(map(content, [['TOTAL_BUDGET', 'k9']])).toBe('${k9/2} and ${k9}');
  });

  it('picks the longest matching label for overlapping names', () => {
    const content = '${JOB_DIR} ${JOB_DIR_ROOT}';
    expect(
      map(content, [
        ['JOB_DIR', 'a1'],
        ['JOB_DIR_ROOT', 'b2'],
      ])
    ).toBe('${a1} ${b2}');
  });

  it('preserves minified names containing $$ (#237)', () => {
    expect(map('Usage: ${MAX_TIMEOUT()} ms', [['MAX_TIMEOUT', 'J$$']])).toBe(
      'Usage: ${J$$()} ms'
    );
  });

  it('substitutes UNKNOWN_<idx> fallback labels', () => {
    const result = promptSync.applyIdentifierMapping(
      'Value: ${UNKNOWN_0}',
      [0],
      {},
      ['zZ'],
      '1.0.0'
    );
    expect(result).toBe('Value: ${zZ}');
  });

  it('still replaces <<CCVERSION>> outside interpolations', () => {
    const result = promptSync.applyIdentifierMapping(
      'CC <<CCVERSION>> built <<BUILD_TIME>>',
      [],
      {},
      [],
      '2.1.214',
      false,
      '2026-01-01T00:00:00Z'
    );
    expect(result).toBe('CC 2.1.214 built 2026-01-01T00:00:00Z');
  });
});
