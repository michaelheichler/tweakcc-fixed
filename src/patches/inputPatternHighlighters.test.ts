import { describe, expect, it, vi } from 'vitest';

import { InputPatternHighlighter } from '../types';
import { writeInputPatternHighlighters } from './inputPatternHighlighters';

vi.mock('./index', async () => {
  const actual = await vi.importActual<typeof import('./index')>('./index');
  return {
    ...actual,
    findChalkVar: () => 'chalk',
    showDiff: vi.fn(),
  };
});

const baseHighlighter = (
  overrides: Partial<InputPatternHighlighter>
): InputPatternHighlighter => ({
  name: 'test',
  regex: 'ok',
  regexFlags: 'g',
  format: '{MATCH}',
  styling: [],
  foregroundColor: '#ffffff',
  backgroundColor: null,
  enabled: true,
  ...overrides,
});

describe('writeInputPatternHighlighters', () => {
  it('skips invalid user regexes and still emits valid highlighters', () => {
    const input =
      'let props={inputValue:inputText,other:1};' +
      'return R.createElement(T,{key:E,color:N.highlight?.color,dimColor:N.highlight?.dimColor,inverse:N.highlight?.inverse},R.createElement(I,null,N.text));' +
      ';let ranges=React.useMemo(()=>{let arr=[];if(a&&b&&!c)arr.push({start:s,end:s+l.length,color:"warning",priority:1})},[]);';

    const result = writeInputPatternHighlighters(input, [
      baseHighlighter({ name: 'broken', regex: '[', regexFlags: 'g' }),
      baseHighlighter({ name: 'valid', regex: 'todo', regexFlags: '' }),
    ]);

    expect(result).not.toBeNull();
    expect(result).toContain('matchAll(new RegExp("todo", "g"))');
    expect(result).not.toContain('new RegExp("["');
  });

  // CC >=2.1.186 migrated the UI bundle from React.createElement to the jsx
  // runtime: children move into a `children:` prop and the key becomes the
  // third jsx() argument.
  const jsxRenderer =
    'return jte.jsx(h,{color:SYe.highlight?.color,' +
    'dimColor:SYe.highlight?.dimColor,inverse:SYe.highlight?.inverse,' +
    'children:jte.jsx(Ac,{children:SYe.text})},fVy);';

  const jsxFile =
    'let props={inputValue:te,other:1};' +
    jsxRenderer +
    ';let ranges=Pi.useMemo(()=>{let arr=[];if(a&&b&&!c)' +
    'arr.push({start:s,end:s+l.length,color:"warning",priority:20})},[a]);';

  it('patches the jsx-runtime renderer shape (CC >=2.1.186)', () => {
    const result = writeInputPatternHighlighters(jsxFile, [
      baseHighlighter({ name: 'todo', regex: 'TODO', styling: ['bold'] }),
    ]);

    expect(result).not.toBeNull();
    // Renderer: styling props forwarded, key kept as the third jsx() argument,
    // and the text run through the chalk `style` fn when one is present.
    expect(result).toContain(
      'children:jte.jsx(Ac,{children:(SYe.highlight?.style??' +
        '(typeof SYe.highlight?.color==="function"?SYe.highlight.color:void 0))' +
        '?(SYe.highlight?.style??(typeof SYe.highlight?.color==="function"?' +
        'SYe.highlight.color:void 0))(SYe.text):SYe.text})},fVy)'
    );
    for (const prop of [
      'backgroundColor',
      'inverse',
      'bold',
      'italic',
      'underline',
      'strikethrough',
    ]) {
      expect(result).toContain(`,${prop}:(SYe.highlight?.style??`);
    }
    // dimColor is forwarded unconditionally — a chalk style fn can't express it.
    expect(result).toContain(',dimColor:SYe.highlight?.dimColor,');
    // The pristine renderer must be gone, and no createElement shape invented.
    expect(result).not.toContain(jsxRenderer);
    expect(result).not.toContain('createElement');
    // Highlighter push + dependency-array wiring still land.
    expect(result).toContain('matchAll(new RegExp("TODO", "g"))');
    expect(result).toContain(
      'color:"#ffffff",bold:!0,style:(x)=>chalk.bold(x)'
    );
    expect(result).toContain(',[a,te]);');
  });

  it('re-applying the jsx renderer patch is a no-op', () => {
    const once = writeInputPatternHighlighters(jsxFile, [
      baseHighlighter({ name: 'todo', regex: 'TODO' }),
    ]);
    expect(once).not.toBeNull();

    const twice = writeInputPatternHighlighters(once as string, [
      baseHighlighter({ name: 'todo', regex: 'TODO' }),
    ]);
    // The renderer half must not fail (or double-splice) on an already
    // patched file.
    expect(twice).not.toBeNull();
    expect(
      (twice as string).split('children:jte.jsx(Ac,{children:(').length - 1
    ).toBe(1);
  });
});
