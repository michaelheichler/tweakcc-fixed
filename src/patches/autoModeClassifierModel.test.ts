import { describe, expect, it } from 'vitest';
import { writeAutoModeClassifierModel } from './autoModeClassifierModel';

const SHAPE_2_1_177 =
  'function Gr9(){let H=w7(),_=j_("tengu_auto_mode_config",{}),q=_?.modelByMainModel;' +
  'if(q){let K=HW(D9(H));if(_J(H)){let T=q[`${K}[1m]`];if(T)return T}let O=q[K];if(O)return O}' +
  'if(_?.model)return _.model;' +
  'if(KJ_(H)||OJ_(H))return iM_(H);' +
  'return H}';

const SHAPE_2_1_170 =
  'function Fr7(){let H=w7(),_=j_("tengu_auto_mode_config",{}),q=_?.modelByMainModel;' +
  'if(q){let K=W9(H).replace(/\\[1m\\]$/,"");if(_J(H)){let T=q[`${K}[1m]`];if(T)return T}let O=q[K];if(O)return O}' +
  'if(_?.model)return _.model;' +
  'if(KJ_(H)||OJ_(H)){let K=$_.ANTHROPIC_DEFAULT_OPUS_MODEL??jO().opus48;if((_J(H)||UE(H))&&!_J(K)&&!wP_(K))return K+"[1m]";return K}' +
  'return H}';

const SHAPE_2_1_167 =
  'function Sr1(){let H=w7(),_=j_("tengu_auto_mode_config",{}),q=_?.modelByMainModel;' +
  'if(q){let K=W9(H).replace(/\\[1m\\]$/,"");if(_J(H)){let T=q[`${K}[1m]`];if(T)return T}let O=q[K];if(O)return O}' +
  'if(_?.model)return _.model;return H}';

describe('writeAutoModeClassifierModel', () => {
  it('rewrites the 2.1.177 resolver (nested key-normalization + collapsed Fable branch)', () => {
    const file = `var A=1;${SHAPE_2_1_177}var B=2;`;
    const result = writeAutoModeClassifierModel(file, 'sonnet');
    expect(result).toContain('function Gr9(){return "claude-sonnet-4-6"}');
    expect(result).not.toContain('tengu_auto_mode_config');
    expect(result).toContain('var A=1;');
    expect(result).toContain('var B=2;');
  });

  it('rewrites the 2.1.170 resolver (with the Fable default-opus branch)', () => {
    const file = `var A=1;${SHAPE_2_1_170}var B=2;`;
    const result = writeAutoModeClassifierModel(file, 'sonnet');
    expect(result).toContain('function Fr7(){return "claude-sonnet-4-6"}');
    expect(result).not.toContain('tengu_auto_mode_config');
    expect(result).toContain('var A=1;');
    expect(result).toContain('var B=2;');
  });

  it('still rewrites the 2.1.167 resolver', () => {
    const file = `var A=1;${SHAPE_2_1_167}var B=2;`;
    const result = writeAutoModeClassifierModel(file, 'haiku');
    expect(result).toContain('function Sr1(){return "claude-haiku-4-5"}');
  });

  it('is a no-op for choice=default', () => {
    const file = `var A=1;${SHAPE_2_1_170}`;
    expect(writeAutoModeClassifierModel(file, 'default')).toBe(file);
  });

  it('skips an already-patched resolver instead of failing', () => {
    const patched = writeAutoModeClassifierModel(
      `var A=1;${SHAPE_2_1_170}`,
      'sonnet'
    );
    expect(patched).not.toBeNull();
    expect(writeAutoModeClassifierModel(patched as string, 'sonnet')).toBe(
      patched
    );
  });
});
