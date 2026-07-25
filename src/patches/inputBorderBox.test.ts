import { describe, it, expect, vi } from 'vitest';
import { writeInputBoxBorder } from './inputBorderBox';

// input-border-box is opt-in (removeBorder). It strips the PromptInput box
// border across three independent sites. This fixture mirrors all three of the
// minified shapes the patch's regexes target:
//
//  1. swarmBanner branch — top/bottom `"─".repeat(N)` lines colored `.bgColor`.
//     The top line is the `VAR.text?<Fragment>:"─".repeat(N)` ternary; the
//     bottom is the bare `"─".repeat(N)`. Both use the same Text component
//     (`Z1`), the same theme var (`T`) and width var (`W`).
//  2. main input Box — `borderColor:YB(),borderStyle:"round",...,borderText:`.
//  3. external editor Box — `borderStyle:"round",...}` near "Save and close editor".
const TOP_BORDER =
  'createElement(Z1,{color:T.bgColor},T.text?createElement(Fr,null,"─",T.text,"──"):"─".repeat(W))';
const BOTTOM_BORDER = 'createElement(Z1,{color:T.bgColor},"─".repeat(W))';
const MAIN_INPUT =
  'createElement(Bx,{borderColor:YB(),borderStyle:"round",borderLeft:!1,borderRight:!1,borderBottom:!0,width:"100%",borderText:QV(M)},rest)';
const EXTERNAL_EDITOR =
  'createElement(Bx,{borderStyle:"round",borderLeft:!1,borderRight:!1,borderBottom:!0,width:"100%"},createElement(Z1,null,"Save and close editor"))';

const FIXTURE = `a=1;K?${TOP_BORDER}:${MAIN_INPUT};b=2;${BOTTOM_BORDER};c=3;${EXTERNAL_EDITOR};d=4;`;

describe('writeInputBoxBorder', () => {
  it('returns the file unchanged when removeBorder is false (opt-in)', () => {
    const out = writeInputBoxBorder(FIXTURE, false);
    expect(out).toBe(FIXTURE);
  });

  it('blanks the swarmBanner top and bottom ─.repeat border lines', () => {
    const out = writeInputBoxBorder(FIXTURE, true);
    expect(out).not.toBeNull();
    // Both ─.repeat lines collapse to an empty Text using the same component.
    expect(out).toContain('createElement(Z1,null,"")');
    expect(out).not.toContain(BOTTOM_BORDER);
    expect(out).not.toContain(TOP_BORDER);
    expect(out).not.toContain('"─".repeat');
  });

  it('disables the main input Box round border (keeps borderColor/borderText)', () => {
    const out = writeInputBoxBorder(FIXTURE, true)!;
    expect(out).toContain(
      'borderColor:YB(),borderStyle:undefined,borderLeft:!1,borderRight:!1,borderBottom:!0,width:"100%",borderText:'
    );
    // The surrounding props are preserved verbatim.
    expect(out).toContain('borderColor:YB(),');
  });

  it('disables the external editor Box round border', () => {
    const out = writeInputBoxBorder(FIXTURE, true)!;
    expect(out).toContain(
      'borderStyle:undefined,borderLeft:!1,borderRight:!1,borderBottom:!0,width:"100%"}'
    );
    expect(out).toContain('Save and close editor');
  });

  it('removes every borderStyle:"round" once all three sites are patched', () => {
    const out = writeInputBoxBorder(FIXTURE, true)!;
    expect(out).not.toContain('borderStyle:"round"');
  });

  it('still patches when only the main input Box site is present', () => {
    const onlyMain = `x=1;${MAIN_INPUT};y=2;`;
    const out = writeInputBoxBorder(onlyMain, true);
    expect(out).not.toBeNull();
    expect(out).toContain('borderStyle:undefined,borderLeft:!1');
    expect(out).not.toContain('borderStyle:"round"');
  });

  // CC >= 2.1.186 shape: jsx() runtime + React-compiler memoization. The
  // banner rules live in their own component reached through
  // `{banner,columns,fastModeTag,borderOnly}`, the ─ are `─` escapes, and
  // the main input Box + external editor Box share ONE hoisted border-props
  // object. `\\u2500` here is a literal backslash-u in the bundle text.
  const JSX_BANNER_FN =
    'function s8t(vhI){let JPr=wVf.c(27),' +
    '{banner:hN,columns:whI,fastModeTag:A6e,borderOnly:rrl}=vhI;' +
    'let aui=A6e?Bt(A6e)+2:0,lui=hN.text?Bt(hN.text)+2:0,' +
    'cui=aui||lui?"\\u2500\\u2500":"",nrl=Math.max(0,whI-aui-lui-cui.length),' +
    'QPr=hN.gradient,Vvt;' +
    'Vvt=QPr?C4.jsx(vVf,{count:nrl,colors:QPr}):"\\u2500".repeat(nrl);' +
    'let XPr=rrl?"\\u2500".repeat(aui+lui+cui.length):' +
    'C4.jsxs(C4.Fragment,{children:[A6e,hN.text,cui]});' +
    'return C4.jsxs(h,{color:hN.bgColor,children:[Vvt,XPr]})}' +
    'function vVf({count:e,colors:t}){return "\\u2500".repeat(e)}';
  const JSX_HOISTED_BORDER =
    'ty=v5?{}:{borderColor:(()=>{if(aZ())return"promptBorder";return fV[y]})(),' +
    'borderStyle:"round",borderLeft:!1,borderRight:!1,borderBottom:!0};' +
    'if(Uc)return qh.jsx(k,{...ty,width:"100%",children:' +
    'qh.jsx(h,{children:"Save and close editor to continue..."})});';
  const JSX_FIXTURE = `a=1;${JSX_BANNER_FN}b=2;${JSX_HOISTED_BORDER}c=3;`;

  it('blanks the jsx-runtime banner rules without touching the banner text', () => {
    const out = writeInputBoxBorder(JSX_FIXTURE, true);
    expect(out).not.toBeNull();
    // Every ─ rule inside the banner component is gone…
    expect(out).toContain('cui=aui||lui?"":""');
    expect(out).toContain('Vvt="";');
    expect(out).toContain('let XPr=rrl?"":C4.jsxs(');
    // …including the gradient variant, which collapses to the same empty string.
    expect(out).not.toContain('C4.jsx(vVf,{count:nrl,colors:QPr})');
    // The banner text, fastMode tag and width math survive untouched.
    expect(out).toContain('children:[A6e,hN.text,cui]');
    expect(out).toContain('nrl=Math.max(0,whI-aui-lui-cui.length)');
  });

  it('leaves ─ rules outside the banner component alone', () => {
    const out = writeInputBoxBorder(JSX_FIXTURE, true)!;
    // The gradient helper that follows the component still draws its rule.
    expect(out).toContain(
      'function vVf({count:e,colors:t}){return "\\u2500".repeat(e)}'
    );
  });

  it('disables the hoisted border-props object shared by both jsx Boxes', () => {
    const out = writeInputBoxBorder(JSX_FIXTURE, true)!;
    expect(out).toContain(
      'borderStyle:undefined,borderLeft:!1,borderRight:!1,borderBottom:!0}'
    );
    expect(out).not.toContain('borderStyle:"round"');
    // borderColor thunk and the external-editor branch are preserved.
    expect(out).toContain('borderColor:(()=>{if(aZ())return"promptBorder"');
    expect(out).toContain('Save and close editor to continue...');
  });

  it('patches the jsx shape even when only the hoisted object is present', () => {
    const out = writeInputBoxBorder(`x=1;${JSX_HOISTED_BORDER}y=2;`, true);
    expect(out).not.toBeNull();
    expect(out).toContain('borderStyle:undefined,borderLeft:!1');
  });

  it('returns null (logging) when no border pattern is present', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      writeInputBoxBorder('function unrelated(){return 1}', true)
    ).toBeNull();
    errSpy.mockRestore();
  });
});
