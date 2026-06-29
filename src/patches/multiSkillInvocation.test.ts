import { describe, expect, it, vi } from 'vitest';

import { writeMultiSkillInvocation } from './multiSkillInvocation';

// Stock 2.1.195 seam: the leading-skill dispatch inside the executor's
// `case"prompt":`. `bcl` runs one skill and returns its message set; the patch
// splices a sibling pass between that call and the `return`.
const SEAM =
  'case"prompt":{let p=await bcl(c,t,r,o,s,l,d.hookMessages);return ke(u),p}catch(d){throw d}';

describe('multiSkillInvocation', () => {
  it('splices a sibling-dispatch pass after the leading bcl call', () => {
    const result = writeMultiSkillInvocation(SEAM);
    expect(result).not.toBeNull();
    // Leading call + return preserved verbatim.
    expect(result).toContain('let p=await bcl(c,t,r,o,s,l,d.hookMessages);');
    expect(result).toContain('return ke(u),p}catch(d){throw d}');
    // Sibling pass: parse args (t) for /tokens, resolve via mE against the ctx
    // registry, re-invoke bcl, concatenate messages — all guarded by try/catch.
    expect(result).toContain('try{let __tcMsiTok=');
    expect(result).toContain('__tcMsiRe.exec(t)');
    expect(result).toContain('mE(__tcMsiN,r.options.commands)');
    expect(result).toContain(
      'await bcl(__tcMsiC,__tcMsiA,r,[],[],myt.randomUUID(),[])'
    );
    expect(result).toContain(
      'p={...p,messages:[...p.messages,...__tcMsiR.messages]}'
    );
    expect(result).toContain('}catch(__tcMsiE){}');
    // Only user-invocable, enabled, prompt-type siblings are dispatched.
    expect(result).toContain('__tcMsiC.type!=="prompt"');
    expect(result).toContain('__tcMsiC.userInvocable===!1');
    expect(result).toContain('!HH(__tcMsiC)');
  });

  it('preserves minifier-renamed identifiers', () => {
    // result→$p, command→$c, args→$a, ctx→$x, cleanup→$k, telemetry→$u
    const renamed =
      'let $p=await bcl($c,$a,$x,$o,$s,$l,$d.hookMessages);return $k($u),$p}';
    const result = writeMultiSkillInvocation(renamed);
    expect(result).not.toBeNull();
    expect(result).toContain(
      'let $p=await bcl($c,$a,$x,$o,$s,$l,$d.hookMessages);'
    );
    expect(result).toContain('__tcMsiRe.exec($a)');
    expect(result).toContain('mE(__tcMsiN,$x.options.commands)');
    expect(result).toContain(
      'await bcl(__tcMsiC,__tcMsiA,$x,[],[],myt.randomUUID(),[])'
    );
    expect(result).toContain(
      '$p={...$p,messages:[...$p.messages,...__tcMsiR.messages]}'
    );
    expect(result).toContain('return $k($u),$p}');
  });

  it('is a no-op when already patched (idempotent)', () => {
    const once = writeMultiSkillInvocation(SEAM);
    expect(once).not.toBeNull();
    expect(writeMultiSkillInvocation(once as string)).toBe(once);
  });

  it('returns null when the dispatch seam is absent', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      expect(writeMultiSkillInvocation('const x=1;')).toBeNull();
      expect(consoleError).toHaveBeenCalledWith(
        'patch: multiSkillInvocation: failed to find the leading-skill dispatch (bcl call site)'
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
