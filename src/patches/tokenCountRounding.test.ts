import { describe, expect, it } from 'vitest';

import { writeTokenCountRounding } from './tokenCountRounding';

describe('writeTokenCountRounding', () => {
  it('wraps only the token count expression in modern spinner code', () => {
    const input =
      'let FH=$?ZH:SH.current,lH=H7(zH),QH=J8(lH),aH=L&&!L.isIdle?L.progress?.tokenCount??0:AH+X,M$=M9(aH),dH=J?`${M$} tokens`:`${$$.arrowDown} ${M$} tokens`,xH=J8(dH),B$=[J9.createElement(k,{key:"tokens"},M$," tokens")];';

    const result = writeTokenCountRounding(input, 1000);

    expect(result).toContain('M$=M9(Math.round((aH)/1000)*1000)');
    expect(result).toContain('dH=J?`${M$} tokens`');
    expect(result).not.toContain('M9(Math.round((aH),dH=');
  });

  it('accepts the current config object shape without emitting object strings', () => {
    const input =
      'let FH=$?ZH:SH.current,lH=H7(zH),QH=J8(lH),aH=L&&!L.isIdle?L.progress?.tokenCount??0:AH+X,M$=M9(aH),dH=J?`${M$} tokens`:`${$$.arrowDown} ${M$} tokens`,xH=J8(dH),B$=[J9.createElement(k,{key:"tokens"},M$," tokens")];';

    const result = writeTokenCountRounding(input, {
      threshold: 1000,
    });

    expect(result).toContain('M$=M9(Math.round((aH)/1000)*1000)');
    expect(result).not.toContain('[object Object]');
  });

  it('defaults object config to 1000 when threshold is omitted', () => {
    const input =
      'let FH=$?ZH:SH.current,lH=H7(zH),QH=J8(lH),aH=L&&!L.isIdle?L.progress?.tokenCount??0:AH+X,M$=M9(aH),dH=J?`${M$} tokens`:`${$$.arrowDown} ${M$} tokens`,xH=J8(dH),B$=[J9.createElement(k,{key:"tokens"},M$," tokens")];';

    const result = writeTokenCountRounding(input, {});

    expect(result).toContain('M$=M9(Math.round((aH)/1000)*1000)');
    expect(result).not.toContain('[object Object]');
  });

  it('wraps the count in the jsx() runtime shape (CC >=2.1.186)', () => {
    // Verbatim shape from pristine CC 2.1.219/2.1.220: `key:"tokens"` is gone,
    // the key is jsxs()'s positional third argument.
    const input =
      'let Ee=t?P:ae.current,he=ra(O),Oe=Bt(he),ve=de,Ae=yd(ve),Fe=`${qe.arrowDown} ${Ae} tokens`,ge=Bt(Fe),yr=[...!I&&Ht?[Fp.jsx(h,{dimColor:!0,children:he},"elapsedTime")]:[],...!I&&gr?[Fp.jsxs(k,{flexDirection:"row",children:[Fp.jsx(RRp,{mode:e}),Fp.jsxs(h,{dimColor:!0,children:[Ae," tokens"]})]},"tokens")]:[]];';

    const result = writeTokenCountRounding(input, 1000);

    expect(result).toContain('Ae=yd(Math.round((ve)/1000)*1000)');
    expect(result).toContain('Fe=`${qe.arrowDown} ${Ae} tokens`');
    expect(result).toContain('Fp.jsx(RRp,{mode:e})');
    expect(result).toContain('children:[Ae," tokens"]})]},"tokens")');
    expect((result?.length ?? 0) - input.length).toBe(24);
  });

  it('escapes $ in the count variable name in the jsx() shape', () => {
    const input =
      'let ve=de,M$=yd(ve),Fe=`${M$} tokens`,yr=[Fp.jsxs(h,{dimColor:!0,children:[M$," tokens"]})]},"tokens")];';

    const result = writeTokenCountRounding(input, 500);

    expect(result).toContain('M$=yd(Math.round((ve)/500)*500)');
    expect(result).not.toContain('[object Object]');
  });

  it('ignores " tokens" renders that carry no positional "tokens" key', () => {
    // Falls through to the older patterns rather than splicing an unrelated
    // element such as the /context breakdown rows.
    const input =
      'let yZe=yd(nn),B$=[Fp.jsxs(h,{dimColor:!0,wrap:"truncate",children:[yZe," tokens"]})];';

    const result = writeTokenCountRounding(input, 1000);

    expect(result).toBeNull();
  });

  it('does not match across comma-separated initializers', () => {
    const input =
      'let M$=M9(aH),dH=J?`${M$} tokens`:`${$$.arrowDown} ${M$} tokens`,xH=J8(dH),tH=V&&R.current!==null&&(q||B.current!==null&&Z===null),j$=tH?H7(Math.max(1000,(q?C:B.current??C)-R.current)):null,D$=fr_(OH),uH=tH?`${q?"running":"ran"} tool for ${j$}`:Z==="thinking"?`${D$}${W}`:null,B$=[J9.createElement(k,{key:"tokens"},M$," tokens")];';

    const result = writeTokenCountRounding(input, 1000);

    expect(result).toBeTruthy();
    expect(result).not.toContain('D$=fr_(OH)/1000)*1000)');
    expect(result).toContain('D$=fr_(OH)');
  });
});
