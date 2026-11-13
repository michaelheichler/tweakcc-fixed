import { describe, it, expect, vi } from 'vitest';
import { writeModelCustomizations, CUSTOM_MODELS } from './modelSelector';

const FIXTURE =
  'q=1;function $Hk(B,Q){let aZ=B.foo,nQ=[{value:"claude-x",label:"X",description:"Built in"}];' +
  'if(Q){let mV=Q.model,nm=Q.name; nQ.push({value:mV,label:nm,description:"Custom model"})}return nQ}z=2;';

describe('writeModelCustomizations', () => {
  it.each(CUSTOM_MODELS)(
    'adds configured model $value to the discovered list',
    model => {
      const out = writeModelCustomizations(FIXTURE);

      expect(out).not.toBeNull();
      expect(out).toContain(`nQ.push(${JSON.stringify(model)});`);
    }
  );

  it('inserts models before the user supplied model', () => {
    const out = writeModelCustomizations(FIXTURE)!;
    const declEnd =
      out!.indexOf('description:"Built in"}];') +
      'description:"Built in"}];'.length;
    const firstModelPush = `nQ.push(${JSON.stringify(CUSTOM_MODELS[0])});`;
    const injectAt = out.indexOf(firstModelPush);
    const origPush = out!.indexOf('description:"Custom model"');
    expect(injectAt).toBe(declEnd);
    expect(injectAt).toBeLessThan(origPush);
  });
});

describe('model list insertion shapes', () => {
  it('honors the let/comma declaration via the `let `-prefixed form too', () => {
    const fixture =
      'function r0(A){let nQ=[{value:"a",label:"A",description:"Built in"}],zz=1;' +
      ' nQ.push({value:x,label:y,description:"Custom model"});return nQ}';
    const out = writeModelCustomizations(fixture);
    expect(out).not.toBeNull();
    expect(out).toContain(`nQ.push(${JSON.stringify(CUSTOM_MODELS[0])});`);
  });

  it('matches the CC 2.1.197 shape where the push is preceded by `;` (no space)', () => {
    const fixture =
      'function Rmp(e){let t=Amp(e),n=1;for(let l of e){if(t.has(l))continue;' +
      't.push({value:l,label:l,description:"Custom model"})}return t}';
    const out = writeModelCustomizations(fixture);
    expect(out).not.toBeNull();
    expect(out).toContain(`t.push(${JSON.stringify(CUSTOM_MODELS[0])});`);
    const declEnd =
      out!.indexOf('let t=Amp(e),n=1;') + 'let t=Amp(e),n=1;'.length;
    const firstModelPush = `t.push(${JSON.stringify(CUSTOM_MODELS[0])});`;
    const injectAt = out!.indexOf(firstModelPush);
    expect(injectAt).toBe(declEnd);
  });

  it('keeps a `$`-bearing list var name intact (escapeIdent path)', () => {
    const fixture =
      'function f($a){let $L=[{value:"a",label:"A",description:"Built in"}];' +
      ' $L.push({value:x,label:y,description:"Custom model"});return $L}';
    const out = writeModelCustomizations(fixture);
    expect(out).not.toBeNull();
    expect(out).toContain(`$L.push(${JSON.stringify(CUSTOM_MODELS[0])});`);
  });

  it('produces valid JS injection (descriptions with special chars stay escaped)', () => {
    const out = writeModelCustomizations(FIXTURE)!;
    const firstModelPush = `nQ.push(${JSON.stringify(CUSTOM_MODELS[0])});`;
    const start = out.indexOf(firstModelPush);
    const injected = out.slice(start, out.indexOf('if(Q){', start));
    expect(() => new Function('nQ', injected)).not.toThrow();
    expect(injected.match(/nQ\.push\(\{/g)).toHaveLength(CUSTOM_MODELS.length);
  });

  it('is idempotent: returns the file unchanged when custom models already present', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const already = `x=1;nQ.push(${JSON.stringify(CUSTOM_MODELS[0])});y=2;`;
    expect(writeModelCustomizations(already)).toBe(already);
    logSpy.mockRestore();
  });

  it('returns null when the custom-model push site is absent', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      writeModelCustomizations('function f(){let nQ=[];return nQ}')
    ).toBeNull();
    errSpy.mockRestore();
  });

  it('returns null when the push site exists but no declaring function is found', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const noDecl =
      'x=1; nQ.push({value:x,label:y,description:"Custom model"});';
    expect(writeModelCustomizations(noDecl)).toBeNull();
    errSpy.mockRestore();
  });
});

const pickerRowsAfterPatch = (
  nativeRows: { value: string; label: string; description?: string }[]
) => {
  const fixture =
    `function f(){let n=${JSON.stringify(nativeRows)};` +
    'if(false)n.push({value:x,label:y,description:"Custom model"});return n}';
  const patched = writeModelCustomizations(fixture);
  return new Function(`${patched};return f();`)() as {
    value: string;
    label: string;
  }[];
};

it.each([
  { nativeRows: [] },
  { nativeRows: [{ value: 'claude-fable-5-2', label: 'Fable 5.2' }] },
  { nativeRows: [{ value: 'fable', label: 'Fable 5.2' }] },
])('makes the native Fable picker entry available once', ({ nativeRows }) => {
  const rows = pickerRowsAfterPatch(nativeRows);

  expect(
    rows.filter(
      row => row.value === 'claude-fable-5-2' || row.label === 'Fable 5.2'
    )
  ).toHaveLength(1);
});
