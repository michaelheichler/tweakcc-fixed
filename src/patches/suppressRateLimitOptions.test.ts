import { describe, it, expect, vi } from 'vitest';
import { writeSuppressRateLimitOptions } from './suppressRateLimitOptions';

// suppressRateLimitOptions neutralizes CC's onOpenRateLimitOptions callback by
// replacing the prop's value var with a no-op (`()=>{}`), so the rate-limit
// options entrypoint can't be opened.
//
// FIXTURE_P1 mirrors the lenient first alternation:
//   .createElement(... ,showAllInTranscript:X,agentDefinitions:Y,onOpenRateLimitOptions:CB
const FIXTURE_P1 =
  'Q.createElement(K$,{foo:bar,baz:qux,showAllInTranscript:Z9,agentDefinitions:aD,onOpenRateLimitOptions:hQ8,extra:1})';

// FIXTURE_P2 mirrors the full second alternation (explicit prop list, with
// agentDefinitions appearing BEFORE showAllInTranscript so only pattern 2 hits):
const FIXTURE_P2 =
  'y.createElement($n,{messages:mm,tools:tt,commands:cc,verbose:!0,toolJSX:null,inProgressToolUseIDs:ip,isMessageSelectorVisible:!1,conversationId:cv,screen:sc,agentDefinitions:ad,streamingToolUses:st,showAllInTranscript:sa,onOpenRateLimitOptions:rL9,x:1})';

// FIXTURE_JSX_* mirror the CC >= 2.1.186 jsx() runtime shape (real 2.1.220
// minified props, truncated), where the message list is rendered via
// `Fo.jsx(UXe,{...})` and the two prop orders differ between the transcript
// and the main scroll path.
const FIXTURE_JSX_A =
  'let yt=I||ds()&&!z&&!Cr?Py:void 0,dr=Fo.jsx(UXe,{messages:tNr,tools:_o,commands:Dn,verbose:!0,toolJSX:null,inProgressToolUseIDs:ug.inProgressToolUseIDs,isMessageSelectorVisible:!1,conversationId:ug.conversationKey,screen:lr,agentDefinitions:ee,streamingToolUses:rNr,showAllInTranscript:fr,onOpenRateLimitOptions:CCt,isLoading:bs,scrollRef:yt});';

const FIXTURE_JSX_B =
  'Fo.jsx(UXe,{messages:ug.messages,deferMessages:ug.isMain&&!Uge&&bs,tools:_o,commands:Dn,verbose:re,toolJSX:as,inProgressToolUseIDs:ug.inProgressToolUseIDs,isMessageSelectorVisible:Hv,conversationId:ug.conversationKey,screen:lr,streamingToolUses:ec,showAllInTranscript:fr,agentDefinitions:ee,onOpenRateLimitOptions:CCt,isLoading:bs});';

const FIXTURE_IMPORTED_JSX =
  'LYe=i(uR,{messages:Di.messages,tools:tR,commands:rue,inProgressToolUseIDs:Di.inProgressToolUseIDs,conversationId:Di.conversationKey,screen:"transcript",turn:iue,showAllInTranscript:Il,onOpenRateLimitOptions:sue,scrollRef:jc});';

describe('writeSuppressRateLimitOptions', () => {
  it('replaces the callback var in the imported jsx helper shape (method 4)', () => {
    const out = writeSuppressRateLimitOptions(FIXTURE_IMPORTED_JSX);

    expect(out).not.toBeNull();
    expect(out).toContain('onOpenRateLimitOptions:()=>{}');
    expect(out).not.toContain('onOpenRateLimitOptions:sue');
  });

  it('replaces the callback var in the jsx() runtime shape (method 3)', () => {
    const out = writeSuppressRateLimitOptions(FIXTURE_JSX_A);

    expect(out).not.toBeNull();
    expect(out).toContain('onOpenRateLimitOptions:()=>{}');
    expect(out).not.toContain('onOpenRateLimitOptions:CCt');
    expect(out).toContain('showAllInTranscript:fr,onOpenRateLimitOptions:');
    expect(out).toContain(',isLoading:bs,scrollRef:yt});');
  });

  it('handles both jsx() prop orders (agentDefinitions before/after showAllInTranscript)', () => {
    const out = writeSuppressRateLimitOptions(
      FIXTURE_JSX_A + '\n' + FIXTURE_JSX_B
    );

    expect(out).not.toBeNull();
    expect(out).not.toContain('onOpenRateLimitOptions:CCt');
    expect(out!.match(/onOpenRateLimitOptions:\(\)=>\{\}/g)).toHaveLength(2);
    // the intervening agentDefinitions prop of shape B survives untouched
    expect(out).toContain('showAllInTranscript:fr,agentDefinitions:ee,');
  });

  it('is idempotent: re-running on already-patched jsx output is a no-op', () => {
    const once = writeSuppressRateLimitOptions(FIXTURE_JSX_A);
    const twice = writeSuppressRateLimitOptions(once!);

    expect(twice).toBe(once);
  });

  it('replaces the callback var with a no-op in the lenient (pattern 1) shape', () => {
    const out = writeSuppressRateLimitOptions(FIXTURE_P1);

    expect(out).not.toBeNull();
    expect(out).toContain('onOpenRateLimitOptions:()=>{}');
    // the original callback identifier is gone as a prop value
    expect(out).not.toContain('onOpenRateLimitOptions:hQ8');
    // surrounding props are preserved untouched
    expect(out).toContain('showAllInTranscript:Z9,agentDefinitions:aD');
    expect(out).toContain(',extra:1})');
  });

  it('replaces the callback var with a no-op in the full prop-list (pattern 2) shape', () => {
    const out = writeSuppressRateLimitOptions(FIXTURE_P2);

    expect(out).not.toBeNull();
    expect(out).toContain('onOpenRateLimitOptions:()=>{}');
    expect(out).not.toContain('onOpenRateLimitOptions:rL9');
    // trailing prop after the callback is preserved
    expect(out).toContain('()=>{},x:1})');
  });

  it('neutralizes both alternation shapes present in the same file', () => {
    // Distinct, non-overlapping shapes (pattern 1 + pattern 2) coexist in cli.js
    // on different render paths; both callbacks must be replaced.
    const input = FIXTURE_P1 + ';' + FIXTURE_P2;
    const out = writeSuppressRateLimitOptions(input);

    expect(out).not.toBeNull();
    expect(out).not.toContain('onOpenRateLimitOptions:hQ8');
    expect(out).not.toContain('onOpenRateLimitOptions:rL9');
    expect(out!.match(/onOpenRateLimitOptions:\(\)=>\{\}/g)).toHaveLength(2);
  });

  it('returns null (logging) when the onOpenRateLimitOptions pattern is absent', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      writeSuppressRateLimitOptions('x=1;Q.createElement(K$,{foo:bar})')
    ).toBeNull();
    errSpy.mockRestore();
  });
});

// CC 2.1.247 shipped `onOpenRateLimitOptions:m?.openRateLimitOptions` — an
// optional-chained member, not a bare identifier. Reading only `[$\w]+` left
// `?.openRateLimitOptions` dangling after the arrow, which Bun refuses to parse.
describe('writeSuppressRateLimitOptions — member-expression prop value', () => {
  it('replaces the whole optional-chained value, not just its leading identifier', () => {
    const input =
      'var a=1;wo=r(jg,{message:b,canAnimate:ze,onOpenRateLimitOptions:m?.openRateLimitOptions,onRateLimitAutoQueueContinue:m?.armRateLimit});';
    const out = writeSuppressRateLimitOptions(input);
    expect(out).not.toBeNull();
    expect(out).toContain('onOpenRateLimitOptions:()=>{}');
    expect(out).not.toContain('()=>{}?.openRateLimitOptions');
    expect(out).toContain('onRateLimitAutoQueueContinue:m?.armRateLimit');
  });

  it('still replaces a bare identifier value', () => {
    const input =
      'var a=1;o(Ol,{param:Je,onOpenRateLimitOptions:Xp,verbose:et});';
    const out = writeSuppressRateLimitOptions(input);
    expect(out).toContain('onOpenRateLimitOptions:()=>{}');
    expect(out).toContain('verbose:et');
  });
});
