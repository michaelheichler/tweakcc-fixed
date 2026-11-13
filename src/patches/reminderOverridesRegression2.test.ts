import { describe, it, expect } from 'vitest';

import { REMINDER_REGISTRY } from './systemReminderOverrides';

import { substitutePlaceholders } from '../systemReminderSync';

const memoryUpdate = REMINDER_REGISTRY.find(r => r.id === 'memory-update')!;

const pdfRef = REMINDER_REGISTRY.find(r => r.id === 'pdf-reference')!;

const MOCK_PDF_COMPOSED =
  'pdf_reference:(e)=>gc([Ce({content:(e.pageCount===null?' +
  '`PDF file: ${ou(e.filename)} (page count unknown, ${Mt(e.fileSize)}). ' +
  'It was not attached because it may be too long. Use the ${nt} tool with the pages parameter. `:' +
  '`PDF file: ${ou(e.filename)} (${e.pageCount} pages, ${Mt(e.fileSize)}). ' +
  'This PDF is too large to read all at once. You MUST use the ${nt} tool. `)' +
  '+"Start by reading the first few pages. Maximum 20 pages per request.",isMeta:!0})]),' +
  'selected_lines_in_ide:(e)=>gc([Ce({content:`x`,isMeta:!0})])';

const MOCK_PDF_SIMPLE =
  'pdf_reference:(e)=>gc([Ce({content:`PDF file: ${ou(e.filename)} ' +
  '(${e.pageCount} pages, ${Mt(e.fileSize)}). Use the ${nt} tool.`,isMeta:!0})])';

const MOCK_PDF_BLOCK =
  'pdf_reference:(e)=>{if("readableWhole"in e&&e.readableWhole)return gc([Ce({content:' +
  '`PDF file: ${ou(e.filename)} (${e.pageCount===null?"page count unknown":`${e.pageCount} ${P(e.pageCount,"page")}`}, ${Mt(e.fileSize)}). ' +
  'Its content is not included here. Read the whole file with the ${nt} tool.`,isMeta:!0})]);' +
  'return gc([Ce({content:(e.pageCount===null?' +
  '`PDF file: ${ou(e.filename)} (page count unknown, ${Mt(e.fileSize)}). It may be too long. Use the ${nt} tool with the pages parameter. `:' +
  '`PDF file: ${ou(e.filename)} (${e.pageCount} ${P(e.pageCount,"page")}, ${Mt(e.fileSize)}). ' +
  '${e.wholeRefusedByModel?`No PDF${e.pageCount>0?`; pages: "1-${e.pageCount}"`:""}.`:"This PDF is too large to read all at once."} ' +
  'You MUST use the ${nt} tool with the pages parameter. `)+`${e.wholeRefusedByModel&&e.pageCount!==null?"":"Start by reading. "}Maximum 20 pages per request.`,isMeta:!0})])},' +
  'selected_lines_in_ide:(e)=>gc([Ce({content:`x`,isMeta:!0})])';

const sub = (id: string, body: string): string => {
  const entry = REMINDER_REGISTRY.find(r => r.id === id)!;
  const { result, errors } = substitutePlaceholders(body, entry.placeholders);
  expect(errors).toEqual([]);
  return result;
};

const STUBS: Record<string, unknown> = {
  Wa: (x: unknown) => x,
  Mk: (o: { content: string }) => o.content,
  gd: (x: unknown) => (Array.isArray(x) ? x : []),
  esc: (x: string) => `<${x}>`,
  Qx: (x: string) => `Proc[${x}]`,
  Lbl: { dream: 'Dream' },
  AMB: 'AMBIENT.',
  gate: () => true,
  TC: 'TaskCreate',
  TU: 'TaskUpdate',
  RD: 'Read',
};

const runCase = (src: string, key: string) => {
  const head = `case"${key}":{`;
  const start = src.indexOf(head);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = src.indexOf('/*END*/', start);
  const text = src.slice(start, end);
  const fn = new Function(
    ...Object.keys(STUBS),
    `return (e)=>{switch(e.type){${text}}}`
  )(...Object.values(STUBS)) as (e: Record<string, unknown>) => unknown;
  return (e: Record<string, unknown>): string | [] => {
    const out = fn({ type: key, ...e });
    if (Array.isArray(out) && out.length === 0) return [];
    expect(Array.isArray(out)).toBe(true);
    const text = (out as string[])[0];
    expect(text).not.toMatch(/undefined|null|\[object /);
    return text;
  };
};

const MEMORY_2291 =
  'case"memory_update":{if(e.source==="sync_unsaved")return Wa([Mk({content:e.summary,isMeta:!0})]);' +
  'let g=[`${Qx(e.source)} updated your memory directory: ${e.summary}`],h=gd(e.paths),b=gd(e.inContextPaths);' +
  'if(h.length>0)g.push(`Files changed: ${h.map(esc).join(", ")}`);' +
  'if(b.length>0)g.push(`Your loaded copy of ${b.map(esc).join(", ")} is now stale relative to disk \\u2014 Read it again if you need current contents.`);' +
  'return g.push(AMB),Wa([Mk({content:g.join(`\n`),isMeta:!0})])}/*END*/';

const mcpInstructions = REMINDER_REGISTRY.find(
  r => r.id === 'mcp-instructions'
)!;

const MCP_2291 =
  'case"mcp_instructions_delta":{let s=gd(e.addedBlocks),g=gd(e.addedNames),h=gd(e.removedNames),b=[];' +
  'if(s.length>0&&g.length>0)b.push(`# MCP Server Instructions\n\nThe following MCP servers have provided instructions for how to use their tools and resources:\n\n${s.join(`\n\n`)}`);' +
  'if(h.length>0)b.push(`The following MCP servers have disconnected. Their instructions above no longer apply:\n${h.join(`\n`)}`),b.push(AMB);' +
  'if(b.length===0)return[];return Wa([Mk({content:b.join(`\n\n`),isMeta:!0})])}/*END*/';

const agentListing = REMINDER_REGISTRY.find(r => r.id === 'agent-listing')!;

const AGENT_2291 =
  'case"agent_listing_delta":{let s=gd(e.addedLines),g=gd(e.addedTypes),h=gd(e.removedTypes),b=[];' +
  'if(s.length>0&&g.length>0){let w=e.isInitial?"Available agent types for the Agent tool:":"New agent types are now available for the Agent tool:";b.push(`${w}\n${s.join(`\n`)}`)}' +
  'if(h.length>0)b.push(`The following agent types are no longer available:\n${h.map((w)=>`- ${w}`).join(`\n`)}`),b.push(AMB);' +
  'if(s.length>0&&g.length>0&&e.isInitial&&e.showConcurrencyNote)b.push("When you launch multiple agents for independent work, send them in a single message with multiple tool uses so they run concurrently.");' +
  'if(b.length===0)return[];return Wa([Mk({content:b.join(`\n\n`),isMeta:!0})])}/*END*/';

const editedTextFile = REMINDER_REGISTRY.find(
  r => r.id === 'edited-text-file'
)!;

const EDITED_2291 =
  "edited_text_file:(e)=>{let n=`Note: ${esc(e.filename)} changed on disk since you last read it. That's usually deliberate.`;" +
  'return Wa([Mk({content:e.snippet===""?`${n} The changes are not shown here; use ${RD} if you need the current content.`:`${n} Here are the relevant changes (shown with line numbers):\n${e.snippet}`,isMeta:!0})])},at_mention_reference:(e)=>1';

const runEdited = (src: string) => {
  const start = src.indexOf('edited_text_file:');
  const end = src.indexOf(',at_mention_reference:');
  const fn = new Function(
    ...Object.keys(STUBS),
    `return ({${src.slice(start, end)}}).edited_text_file`
  )(...Object.values(STUBS)) as (e: Record<string, unknown>) => string[];
  return (e: Record<string, unknown>) => {
    const text = fn(e)[0];
    expect(text).not.toMatch(/undefined|null/);
    return text;
  };
};

describe('pdf-reference page_count_text and stock-stub handling', () => {
  const USER_BODY =
    'PDF ${H.filename}: ${H.pageCountText}, ${l7(H.fileSize)}. Read via ${uq} with \\`pages: "1-5"\\` (max 20/request; pages param required).';
  const render = (out: string, pageCount: number | null): string => {
    const m = out.match(/;return gc\(\[Ce\(\{content:(`.*?`),isMeta/s)!;
    const fn = new Function('e', 'ou', 'Mt', 'nt', 'P', `return ${m[1]}`);
    return fn(
      { filename: 'a.pdf', pageCount, fileSize: 9 },
      (x: string) => x,
      (x: number) => `${x}B`,
      'Read',
      (n: number, w: string) => (n === 1 ? w : w + 's')
    ) as string;
  };
  it("recovers CC's own page-count expression and renders null / 1 / 7", () => {
    const out = pdfRef.apply(MOCK_PDF_BLOCK, USER_BODY, false)!;
    expect(out).toContain(
      '${e.pageCount===null?"page count unknown":`${e.pageCount} ${P(e.pageCount,"page")}`}'
    );
    expect(render(out, null)).toBe(
      'PDF a.pdf: page count unknown, 9B. Read via Read with `pages: "1-5"` (max 20/request; pages param required).'
    );
    expect(render(out, 1)).toContain('PDF a.pdf: 1 page, 9B.');
    expect(render(out, 7)).toContain('PDF a.pdf: 7 pages, 9B.');
  });
  it('synthesizes the expression for shapes that never interpolate it', () => {
    const out = pdfRef.apply(MOCK_PDF_SIMPLE, USER_BODY, false)!;
    expect(out).toContain(
      '${e.pageCount===null?"page count unknown":e.pageCount+(e.pageCount===1?" page":" pages")}'
    );
  });
  it('keeps {{page_count}} working', () => {
    const out = pdfRef.apply(MOCK_PDF_BLOCK, 'N=${H.pageCount}', false)!;
    expect(out).toContain('content:`N=${e.pageCount}`');
  });
  const stub = () =>
    substitutePlaceholders(pdfRef.defaultBody, pdfRef.placeholders).result;
  it('leaves the handler byte-for-byte untouched for the stock stub body', () => {
    expect(pdfRef.apply(MOCK_PDF_BLOCK, stub(), false)).toBe(MOCK_PDF_BLOCK);
    expect(pdfRef.apply(MOCK_PDF_COMPOSED, stub(), false)).toBe(
      MOCK_PDF_COMPOSED
    );
  });
  it('still suppresses with the stock stub body', () => {
    expect(pdfRef.apply(MOCK_PDF_BLOCK, stub(), true)).toContain(
      'pdf_reference:(e)=>[],selected_lines_in_ide'
    );
  });
});

describe('local-command-caveat reminder anchoring', () => {
  const caveat = REMINDER_REGISTRY.find(r => r.id === 'local-command-caveat')!;
  const KEYS = 'var $2="command-name",F2="local-command-caveat",xBe=[F2];';
  const fn = (text: string) =>
    `function jae(){return ke({content:\`<\${F2}>${text}</\${F2}>\`,isMeta:!0})}function qY(e){return 1}`;
  it('anchors on the registry key, not the caveat prose (2.1.285 wording)', () => {
    const file =
      KEYS + fn('The command below was run directly in Claude Code.');
    const out = caveat.apply(file, 'Custom ${Gq_} note.', false)!;
    expect(out).toContain(
      'function jae(){return ke({content:`<${F2}>Custom ${F2} note.</${F2}>`,isMeta:!0})}'
    );
    expect(out).not.toContain('run directly');
  });
  it('still matches the pre-2.1.285 wording', () => {
    const file =
      KEYS + fn('Caveat: The messages below were generated by the user.');
    expect(caveat.apply(file, 'x', false)).toContain('<${F2}>x</${F2}>');
  });
  it('suppresses to an empty emit', () => {
    const out = caveat.apply(KEYS + fn('anything'), '', true)!;
    expect(out).toContain('function jae(){return ke({content:"",isMeta:!0})}');
  });
  it('fails cleanly when the tag key is absent', () => {
    expect(caveat.apply(fn('anything'), 'x', false)).toBeNull();
  });
});

describe('memory-update renders every pristine branch: resolves the source label as a call, never a hardcoded map name', () => {
  const TERSE =
    '{{source}} updated memory: {{summary}}\nFiles: {{paths}}\nStale in context, re-Read: {{in_context_paths}}\n{{ambient_note}}';
  it('resolves the source label as a call, never a hardcoded map name', () => {
    const out = memoryUpdate.apply(
      MEMORY_2291,
      sub('memory-update', TERSE),
      false
    )!;
    expect(out).toContain('${Qx(e.source)} updated memory');
    expect(out).not.toContain('YT3');
  });
});

describe('memory-update renders every pristine branch: drops the files / stale lines exactly when pristine skips their push', () => {
  const TERSE =
    '{{source}} updated memory: {{summary}}\nFiles: {{paths}}\nStale in context, re-Read: {{in_context_paths}}\n{{ambient_note}}';
  const run = () =>
    runCase(
      memoryUpdate.apply(MEMORY_2291, sub('memory-update', TERSE), false)!,
      'memory_update'
    );
  it('drops the files / stale lines exactly when pristine skips their push', () => {
    const r = run();
    expect(
      r({ source: 'dream', summary: 'S', paths: [], inContextPaths: [] })
    ).toBe('Proc[dream] updated memory: S\nAMBIENT.');
    expect(
      r({
        source: 'dream',
        summary: 'S',
        paths: ['a', 'b'],
        inContextPaths: [],
      })
    ).toBe('Proc[dream] updated memory: S\nFiles: <a>, <b>\nAMBIENT.');
    expect(
      r({ source: 'dream', summary: 'S', paths: ['a'], inContextPaths: ['a'] })
    ).toBe(
      'Proc[dream] updated memory: S\nFiles: <a>\nStale in context, re-Read: <a>\nAMBIENT.'
    );
    expect(r({ source: 'dream', summary: 'S', inContextPaths: ['c'] })).toBe(
      'Proc[dream] updated memory: S\nStale in context, re-Read: <c>\nAMBIENT.'
    );
  });
});

describe('memory-update renders every pristine branch: leaves the sync_unsaved early return pristine', () => {
  const TERSE =
    '{{source}} updated memory: {{summary}}\nFiles: {{paths}}\nStale in context, re-Read: {{in_context_paths}}\n{{ambient_note}}';
  const run = () =>
    runCase(
      memoryUpdate.apply(MEMORY_2291, sub('memory-update', TERSE), false)!,
      'memory_update'
    );
  it('leaves the sync_unsaved early return pristine', () => {
    expect(
      run()({ source: 'sync_unsaved', summary: 'unsaved', paths: ['x'] })
    ).toBe('unsaved');
  });
});

describe('memory-update renders every pristine branch: segment placeholders carry pristine text under pristine conditions', () => {
  it('segment placeholders carry pristine text under pristine conditions', () => {
    const out = memoryUpdate.apply(
      MEMORY_2291,
      sub(
        'memory-update',
        '{{source}}: {{summary}}\n{{files_changed}}\n{{stale_copy}}'
      ),
      false
    )!;
    const r = runCase(out, 'memory_update');
    expect(
      r({ source: 'dream', summary: 'S', paths: [], inContextPaths: [] })
    ).toBe('Proc[dream]: S');
    expect(
      r({ source: 'dream', summary: 'S', paths: ['a'], inContextPaths: ['a'] })
    ).toBe(
      'Proc[dream]: S\nFiles changed: <a>\nYour loaded copy of <a> is now stale relative to disk — Read it again if you need current contents.'
    );
  });
});

describe('memory-update renders every pristine branch: the stock body equals pristine on every branch, and is left untouched', () => {
  it('the stock body equals pristine on every branch, and is left untouched', () => {
    const stock = sub('memory-update', memoryUpdate.defaultBody);
    expect(memoryUpdate.apply(MEMORY_2291, stock, false)).toBe(MEMORY_2291);
  });
});

describe('memory-update renders every pristine branch: binds the pre-2.1.288 map-read label', () => {
  const TERSE =
    '{{source}} updated memory: {{summary}}\nFiles: {{paths}}\nStale in context, re-Read: {{in_context_paths}}\n{{ambient_note}}';
  it('binds the pre-2.1.288 map-read label', () => {
    const fixture = MEMORY_2291.replace('${Qx(e.source)}', '${Lbl[e.source]}');
    const r = runCase(
      memoryUpdate.apply(fixture, sub('memory-update', TERSE), false)!,
      'memory_update'
    );
    expect(r({ source: 'dream', summary: 'S', paths: [] })).toBe(
      'Dream updated memory: S\nAMBIENT.'
    );
  });
});

describe('memory-update renders every pristine branch: fails loud when the source label has an unrecognised shape', () => {
  const TERSE =
    '{{source}} updated memory: {{summary}}\nFiles: {{paths}}\nStale in context, re-Read: {{in_context_paths}}\n{{ambient_note}}';
  it('fails loud when the source label has an unrecognised shape', () => {
    const fixture = MEMORY_2291.replace('${Qx(e.source)}', '${Qx(e.source,1)}');
    expect(
      memoryUpdate.apply(fixture, sub('memory-update', TERSE), false)
    ).toBeNull();
  });
});

describe('memory-update renders every pristine branch: suppresses to an empty case', () => {
  it('suppresses to an empty case', () => {
    const out = memoryUpdate.apply(MEMORY_2291, '', true)!;
    expect(
      runCase(out, 'memory_update')({ source: 'dream', summary: 'S' })
    ).toEqual([]);
  });
});

describe('mcp-instructions renders every pristine branch', () => {
  const ADDED = {
    addedBlocks: ['## a\nA'],
    addedNames: ['a'],
    removedNames: [],
  };
  const REMOVED = { addedBlocks: [], addedNames: [], removedNames: ['x', 'y'] };
  const BOTH = {
    addedBlocks: ['## a\nA'],
    addedNames: ['a'],
    removedNames: ['x'],
  };
  it('a terse body with its own wording keeps each half to its own branch', () => {
    const body =
      '# MCP instructions\n{{added_blocks}}\n\nDisconnected (ignore their instructions): {{removed_names}}\n{{ambient_note}}';
    const r = runCase(
      mcpInstructions.apply(MCP_2291, sub('mcp-instructions', body), false)!,
      'mcp_instructions_delta'
    );
    expect(r(ADDED)).toBe('# MCP instructions\n## a\nA');
    expect(r(REMOVED)).toBe(
      '# MCP instructions\n\nDisconnected (ignore their instructions): x\ny\nAMBIENT.'
    );
  });
  it.each([ADDED, REMOVED, BOTH])(
    'section placeholders reproduce pristine for %o',
    delta => {
      const body =
        '{{added_section}}\n\n{{removed_section}}\n\n{{ambient_note}}';
      const out = mcpInstructions.apply(
        MCP_2291,
        sub('mcp-instructions', body),
        false
      )!;
      const r = runCase(out, 'mcp_instructions_delta');
      const pristine = runCase(MCP_2291, 'mcp_instructions_delta');
      expect(r(delta)).toBe(pristine(delta));
    }
  );
  it('an edited legacy {{added_blocks}} body still applies, guarded', () => {
    const legacy = '# MCP Server Instructions (edited)\n\n{{added_blocks}}';
    const r = runCase(
      mcpInstructions.apply(MCP_2291, sub('mcp-instructions', legacy), false)!,
      'mcp_instructions_delta'
    );
    expect(r(ADDED)).toContain('## a\nA');
    expect(r(BOTH)).not.toContain('disconnected');
    expect(r({ removedNames: ['x'] })).not.toContain('\n\n\n');
  });
  it('stock body is a no-op; suppression empties the case', () => {
    expect(
      mcpInstructions.apply(
        MCP_2291,
        sub('mcp-instructions', mcpInstructions.defaultBody),
        false
      )
    ).toBe(MCP_2291);
    expect(
      runCase(
        mcpInstructions.apply(MCP_2291, '', true)!,
        'mcp_instructions_delta'
      )(ADDED)
    ).toEqual([]);
  });
});

describe('agent-listing renders every pristine branch', () => {
  const INITIAL = {
    addedLines: ['- a: A'],
    addedTypes: ['a'],
    removedTypes: [],
    isInitial: true,
    showConcurrencyNote: true,
  };
  const LATER = {
    addedLines: ['- b: B'],
    addedTypes: ['b'],
    removedTypes: [],
    isInitial: false,
    showConcurrencyNote: true,
  };
  const REMOVED = {
    addedLines: [],
    addedTypes: [],
    removedTypes: ['z'],
    isInitial: false,
  };
  const BOTH = {
    addedLines: ['- b: B'],
    addedTypes: ['b'],
    removedTypes: ['z'],
    isInitial: false,
  };
  it('{{heading}} follows isInitial and vanishes on a removal-only delta', () => {
    const body =
      '{{heading}}\n{{listing}}\n\nGone: {{removed}}\n\n{{concurrency_note}}';
    const r = runCase(
      agentListing.apply(AGENT_2291, sub('agent-listing', body), false)!,
      'agent_listing_delta'
    );
    expect(r(INITIAL)).toBe(
      'Available agent types for the Agent tool:\n- a: A\n\nWhen you launch multiple agents for independent work, send them in a single message with multiple tool uses so they run concurrently.'
    );
    expect(r(LATER)).toBe(
      'New agent types are now available for the Agent tool:\n- b: B'
    );
    expect(r(REMOVED)).toBe('Gone: - z');
    expect(r(BOTH)).toBe(
      'New agent types are now available for the Agent tool:\n- b: B\n\nGone: - z'
    );
    expect(r({})).toEqual([]);
  });
  it.each([INITIAL, LATER, REMOVED, BOTH])(
    'section placeholders reproduce pristine for %o',
    delta => {
      const body =
        '{{added_section}}\n\n{{removed_section}}\n\n{{ambient_note}}\n\n{{concurrency_note}}';
      const r = runCase(
        agentListing.apply(AGENT_2291, sub('agent-listing', body), false)!,
        'agent_listing_delta'
      );
      const pristine = runCase(AGENT_2291, 'agent_listing_delta');
      expect(r(delta)).toBe(pristine(delta));
    }
  );
  it('an edited legacy {{listing}} body still applies, guarded', () => {
    const r = runCase(
      agentListing.apply(
        AGENT_2291,
        sub(
          'agent-listing',
          'Available agent types for the Agent tool:\n{{listing}}'
        ),
        false
      )!,
      'agent_listing_delta'
    );
    expect(r(LATER)).toContain('- b: B');
  });
});

describe('edited-text-file renders both snippet branches', () => {
  it('{{changes}} carries pristine\'s snippet==="" ternary', () => {
    const out = editedTextFile.apply(
      EDITED_2291,
      sub(
        'edited-text-file',
        "{{filename}} changed on disk; don't revert it. {{changes}}"
      ),
      false
    )!;
    const r = runEdited(out);
    expect(r({ filename: 'f.ts', snippet: '' })).toBe(
      "<f.ts> changed on disk; don't revert it. The changes are not shown here; use Read if you need the current content."
    );
    expect(r({ filename: 'f.ts', snippet: '12 x' })).toBe(
      "<f.ts> changed on disk; don't revert it. Here are the relevant changes (shown with line numbers):\n12 x"
    );
  });
  it('a bare {{snippet}} line drops on the no-snippet branch; {{read_tool}} binds', () => {
    const r = runEdited(
      editedTextFile.apply(
        EDITED_2291,
        sub(
          'edited-text-file',
          '{{filename}} changed (use {{read_tool}} for more):\n{{snippet}}'
        ),
        false
      )!
    );
    expect(r({ filename: 'f', snippet: '' })).toBe(
      '<f> changed (use Read for more):'
    );
    expect(r({ filename: 'f', snippet: 'd' })).toBe(
      '<f> changed (use Read for more):\nd'
    );
  });
  it('the stock body is a no-op and matches pristine', () => {
    expect(
      editedTextFile.apply(
        EDITED_2291,
        sub('edited-text-file', editedTextFile.defaultBody),
        false
      )
    ).toBe(EDITED_2291);
  });
  it('the <=2.1.233 inline shape also binds {{changes}}', () => {
    const tail =
      "Note: ${H.filename} was modified, either by the user or by a linter. This change was intentional, so make sure to take it into account as you proceed (ie. don't revert it unless the user asks you to). Don't tell the user this, since they are already aware.";
    const old =
      'edited_text_file:(H)=>Wa([Mk({content:H.snippet===""?`' +
      tail +
      ' The diff was omitted because other modified files in this turn already exceeded the snippet budget; use the Read tool if you need the current content.`:`' +
      tail +
      ' Here are the relevant changes (shown with line numbers):\n${H.snippet}`,isMeta:!0})]),at_mention_reference:(e)=>1';
    const r = runEdited(
      editedTextFile.apply(
        old,
        sub('edited-text-file', '{{filename}}: {{changes}}'),
        false
      )!
    );
    expect(r({ filename: 'f', snippet: '' })).toContain(
      'f: The diff was omitted'
    );
    expect(r({ filename: 'f', snippet: 'd' })).toContain(
      'f: Here are the relevant changes'
    );
  });
});
