import { describe, it, expect } from 'vitest';
import { isTweakccHumanName } from './systemPrompts';

// Mirrors the leak detector in applySystemPrompts: capture the identifier that
// OPENS every unescaped `${...}` slot, then keep only tweakcc human-names that
// the prompt's own map failed to resolve.
const placeholderRe = /(?<!\\)\$\{([A-Za-z_][A-Za-z0-9_]*)/g;
const leakedNames = (interpolated: string, union: Set<string>): string[] => [
  ...new Set(
    [...interpolated.matchAll(placeholderRe)]
      .map(m => m[1])
      .filter(n => isTweakccHumanName(n) && union.has(n))
  ),
];

const UNION = new Set([
  'SYSTEM_PROMPT_AGENT_RESUMED_WAS_STOPPED_COMPLETED_VAR_2',
  'OPTIONAL_TAIL_NOTE',
  'AGENT_TOOL_NAME',
  'VERSION',
  // pollution carried by older prompt JSONs
  'JSON',
  'U',
  'P2',
  'HH8',
]);

describe('system-prompt placeholder leak guard', () => {
  it('catches a property-access placeholder (the CC 2.1.206 regression)', () => {
    const interpolated =
      'Agent "${c.agentName}" was stopped (${c.status}); ran to completion. Result:\n\n' +
      '${SYSTEM_PROMPT_AGENT_RESUMED_WAS_STOPPED_COMPLETED_VAR_2.finalText||"(no text output)"}';
    expect(leakedNames(interpolated, UNION)).toEqual([
      'SYSTEM_PROMPT_AGENT_RESUMED_WAS_STOPPED_COMPLETED_VAR_2',
    ]);
  });

  it('still catches the plain `${NAME}` form', () => {
    expect(leakedNames('tail: ${OPTIONAL_TAIL_NOTE}', UNION)).toEqual([
      'OPTIONAL_TAIL_NOTE',
    ]);
  });

  it('catches a call-expression placeholder', () => {
    expect(leakedNames('use ${AGENT_TOOL_NAME(3)} now', UNION)).toEqual([
      'AGENT_TOOL_NAME',
    ]);
  });

  it('does not flag real JS an override may legitimately contain', () => {
    const script =
      'const angles = ${JSON.stringify(CORRECTNESS_ANGLES)};\n' +
      'const n = ${Math.floor(t/2)};';
    expect(leakedNames(script, UNION)).toEqual([]);
  });

  it('does not flag short minified identifiers carried in the union', () => {
    expect(leakedNames('${U.name} and ${P2} and ${HH8.x}', UNION)).toEqual([]);
  });

  it('does not flag an escaped literal placeholder', () => {
    expect(leakedNames('docs say \\${OPTIONAL_TAIL_NOTE} here', UNION)).toEqual(
      []
    );
  });

  it('ignores resolved minified vars that are not human-names', () => {
    expect(leakedNames('${HL7} ${c.status}', UNION)).toEqual([]);
  });

  it('isTweakccHumanName rejects globals and short names, accepts real ones', () => {
    expect(isTweakccHumanName('JSON')).toBe(false);
    expect(isTweakccHumanName('Math')).toBe(false);
    expect(isTweakccHumanName('U')).toBe(false);
    expect(isTweakccHumanName('HH8')).toBe(false);
    expect(isTweakccHumanName('TOOL')).toBe(true);
    expect(isTweakccHumanName('PROMPT_VAR_0')).toBe(true);
  });
});
