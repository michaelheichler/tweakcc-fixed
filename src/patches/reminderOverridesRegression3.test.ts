import { describe, it, expect } from 'vitest';

import { REMINDER_REGISTRY } from './systemReminderOverrides';

import {
  parseReminderMarkdown,
  substitutePlaceholders,
} from '../systemReminderSync';

const memoryUpdate = REMINDER_REGISTRY.find(r => r.id === 'memory-update')!;

const taskListReminder = REMINDER_REGISTRY.find(
  r => r.id === 'task-list-reminder'
)!;

const pdfRef = REMINDER_REGISTRY.find(r => r.id === 'pdf-reference')!;

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

const TASK_2291 =
  'case"task_reminder":{if(!gate())return[];let s=e.content.map((h)=>`#${h.id}. [${h.status}] ${h.subject}`).join(`\n`),' +
  "g=`The task tools haven't been used recently. Consider using ${TC} to add new tasks and ${TU} to update task status.\n`;" +
  'if(s.length>0)g+=`\n\nHere are the existing tasks:\n\n${s}`;return Wa([Mk({content:g,isMeta:!0})])}/*END*/';

describe('task-list-reminder renders with and without tasks', () => {
  const TASKS = { content: [{ id: 1, status: 'pending', subject: 'A' }] };
  it('the existing-tasks block appears only when the list is non-empty', () => {
    const body =
      'Task tools idle; track multi-step work with {{task_create_tool}} / {{task_update_tool}}.\n\n{{existing_tasks}}';
    const r = runCase(
      taskListReminder.apply(
        TASK_2291,
        sub('task-list-reminder', body),
        false
      )!,
      'task_reminder'
    );
    expect(r({ content: [] })).toBe(
      'Task tools idle; track multi-step work with TaskCreate / TaskUpdate.'
    );
    expect(r(TASKS)).toBe(
      'Task tools idle; track multi-step work with TaskCreate / TaskUpdate.\n\nHere are the existing tasks:\n\n#1. [pending] A'
    );
  });
  it('a "Tasks: {{tasks}}" line drops on the empty list', () => {
    const r = runCase(
      taskListReminder.apply(
        TASK_2291,
        sub(
          'task-list-reminder',
          'Use {{task_create_tool}}.\nTasks: {{tasks}}'
        ),
        false
      )!,
      'task_reminder'
    );
    expect(r({ content: [] })).toBe('Use TaskCreate.');
    expect(r(TASKS)).toBe('Use TaskCreate.\nTasks: #1. [pending] A');
  });
  it('keeps the feature gate, and the stock body is a no-op', () => {
    const out = taskListReminder.apply(
      TASK_2291,
      sub('task-list-reminder', 'x {{tasks}}'),
      false
    )!;
    expect(out).toContain('{if(!gate())return[];');
    expect(
      taskListReminder.apply(
        TASK_2291,
        sub('task-list-reminder', taskListReminder.defaultBody),
        false
      )
    ).toBe(TASK_2291);
  });
});

describe('pdf-reference model_refused_note', () => {
  const runPdf = (out: string) => {
    const start = out.indexOf('pdf_reference:');
    const end = out.indexOf(',selected_lines_in_ide:');
    const fn = new Function(
      'ou',
      'Mt',
      'nt',
      'P',
      'gc',
      'Ce',
      `return ({${out.slice(start, end)}}).pdf_reference`
    )(
      (x: string) => x,
      (x: number) => `${x}B`,
      'Read',
      (n: number, w: string) => (n === 1 ? w : w + 's'),
      (x: unknown) => x,
      (o: { content: string }) => o.content
    ) as (e: Record<string, unknown>) => string[];
    return (e: Record<string, unknown>) =>
      fn({ filename: 'a.pdf', fileSize: 9, ...e })[0];
  };
  it("carries pristine's refused sentence and drops when not refused", () => {
    const out = pdfRef.apply(
      MOCK_PDF_BLOCK,
      sub(
        'pdf-reference',
        'PDF {{filename}}: {{page_count_text}}. Use {{read_tool}} with pages.\n{{model_refused_note}}'
      ),
      false
    )!;
    const r = runPdf(out);
    expect(r({ pageCount: 7 })).toBe(
      'PDF a.pdf: 7 pages. Use Read with pages.'
    );
    expect(r({ pageCount: 7, wholeRefusedByModel: true })).toBe(
      'PDF a.pdf: 7 pages. Use Read with pages.\nNo PDF; pages: "1-7".'
    );
    expect(r({ pageCount: null, wholeRefusedByModel: true })).toBe(
      'PDF a.pdf: page count unknown. Use Read with pages.\nNo PDF.'
    );
  });
  it('is empty on shapes that predate the refusal', () => {
    const out = pdfRef.apply(
      MOCK_PDF_SIMPLE,
      sub('pdf-reference', 'x\n{{model_refused_note}}'),
      false
    )!;
    expect(out).toContain('[`${""}`,``]');
  });
});

describe('stock-body no-op covers the whole registry', () => {
  const DUMMY = 'no reminder handlers in here';
  it.each(REMINDER_REGISTRY.filter(e => !e.bodyIsMarker).map(e => e.id))(
    '%s leaves content untouched for its own default body',
    id => {
      const entry = REMINDER_REGISTRY.find(r => r.id === id)!;
      const stock = substitutePlaceholders(
        entry.defaultBody,
        entry.placeholders
      ).result;
      expect(entry.apply(DUMMY, stock, false)).toBe(DUMMY);
      expect(entry.apply(DUMMY, `${stock}\n`, false)).toBe(DUMMY);
      expect(entry.apply(DUMMY, stock.replace(/\n/g, '\r\n'), false)).toBe(
        DUMMY
      );
    }
  );
  it('never short-circuits a suppression or the router marker', () => {
    const router = REMINDER_REGISTRY.find(
      r => r.id === 'mcp-per-server-router'
    )!;
    expect(router.apply(DUMMY, router.defaultBody, false)).toBeNull();
    const mem = REMINDER_REGISTRY.find(r => r.id === 'memory-update')!;
    expect(mem.apply(DUMMY, '', true)).toBeNull();
  });
});

describe('mcp-per-server-router suppression covers client-side blocks', () => {
  const router = REMINDER_REGISTRY.find(r => r.id === 'mcp-per-server-router')!;
  const ZJE =
    'function Zje(e,n){let r=new Map;for(let g of e)if(g.instructions)r.set(g.name,`## ${g.name}\n${g.instructions}`);' +
    'let s=new Set(e.map((g)=>g.name));for(let g of n){if(!s.has(g.serverName))continue;let h=r.get(g.serverName);' +
    'r.set(g.serverName,h?`${h}\n\n${g.block}`:`## ${g.serverName}\n${g.block}`)}return r}';
  const run = (files: Record<string, string>) => {
    const out = router.apply(ZJE, router.defaultBody, false)!;
    const fakeRequire = (m: string) =>
      m === 'os'
        ? { homedir: () => '/h' }
        : {
            readFileSync: (p: string) => {
              const name = p.split('/').pop()!;
              if (!(name in files)) throw new Error('ENOENT');
              return files[name];
            },
          };
    const zje = new Function('require', `${out};return Zje`)(fakeRequire) as (
      e: unknown[],
      n: unknown[]
    ) => Map<string, string>;
    return zje(
      [
        { name: 'claude-in-chrome', instructions: 'CI' },
        { name: 'other', instructions: 'OI' },
      ],
      [
        { serverName: 'claude-in-chrome', block: 'EXTRA' },
        { serverName: 'other', block: 'OB' },
      ]
    );
  };
  it('an emptied mcp-<name>.md drops the server and its extra block', () => {
    const m = run({ 'mcp-claude-in-chrome.md': '<!--\nname: x\n-->\n' });
    expect(m.has('claude-in-chrome')).toBe(false);
    expect(m.get('other')).toBe('## other\nOI\n\nOB');
  });
  it('a custom body keeps the extra block appended', () => {
    const m = run({ 'mcp-claude-in-chrome.md': '<!--\nname: x\n-->\nTERSE' });
    expect(m.get('claude-in-chrome')).toBe(
      '## claude-in-chrome\nTERSE\n\nEXTRA'
    );
  });
});

describe('a body that renders to nothing emits nothing: task-list-reminder: {{existing_tasks}} alone returns [] on an empty list', () => {
  it('task-list-reminder: {{existing_tasks}} alone returns [] on an empty list', () => {
    const r = runCase(
      taskListReminder.apply(
        TASK_2291,
        sub('task-list-reminder', '{{existing_tasks}}'),
        false
      )!,
      'task_reminder'
    );
    expect(r({ content: [] })).toEqual([]);
    expect(r({ content: [{ id: 1, status: 'pending', subject: 'A' }] })).toBe(
      'Here are the existing tasks:\n\n#1. [pending] A'
    );
  });
});

describe('a body that renders to nothing emits nothing: mcp-instructions: {{added_section}} alone returns [] on a removal-only delta', () => {
  it('mcp-instructions: {{added_section}} alone returns [] on a removal-only delta', () => {
    const r = runCase(
      mcpInstructions.apply(
        MCP_2291,
        sub('mcp-instructions', '{{added_section}}'),
        false
      )!,
      'mcp_instructions_delta'
    );
    expect(r({ addedBlocks: [], addedNames: [], removedNames: ['x'] })).toEqual(
      []
    );
    expect(
      r({ addedBlocks: ['## a\nA'], addedNames: ['a'], removedNames: [] })
    ).toContain('## a\nA');
  });
});

describe('a body that renders to nothing emits nothing: agent-listing and memory-update bodies of optional lines only return []', () => {
  it('agent-listing and memory-update bodies of optional lines only return []', () => {
    const agent = runCase(
      agentListing.apply(
        AGENT_2291,
        sub('agent-listing', '{{added_section}}\n\n{{concurrency_note}}'),
        false
      )!,
      'agent_listing_delta'
    );
    expect(agent({ removedTypes: ['z'] })).toEqual([]);
    const mem = runCase(
      memoryUpdate.apply(
        MEMORY_2291,
        sub('memory-update', 'Files: {{paths}}\n{{stale_copy}}'),
        false
      )!,
      'memory_update'
    );
    expect(
      mem({ source: 'dream', summary: 'S', paths: [], inContextPaths: [] })
    ).toEqual([]);
    expect(mem({ source: 'dream', summary: 'S', paths: ['a'] })).toBe(
      'Files: <a>'
    );
  });
});

describe('a body that renders to nothing emits nothing: edited-text-file and pdf-reference return [] for an empty optional render', () => {
  it('edited-text-file and pdf-reference return [] for an empty optional render', () => {
    const edited = editedTextFile.apply(
      EDITED_2291,
      sub('edited-text-file', '{{snippet}}'),
      false
    )!;
    const start = edited.indexOf('edited_text_file:');
    const fn = new Function(
      ...Object.keys(STUBS),
      `return ({${edited.slice(start, edited.indexOf(',at_mention_reference:'))}}).edited_text_file`
    )(...Object.values(STUBS)) as (e: Record<string, unknown>) => unknown;
    expect(fn({ filename: 'f', snippet: '' })).toEqual([]);
    expect(fn({ filename: 'f', snippet: 'd' })).toEqual(['d']);
    const pdf = pdfRef.apply(
      MOCK_PDF_BLOCK,
      sub('pdf-reference', '{{model_refused_note}}'),
      false
    )!;
    expect(pdf).toContain(
      '((c)=>c.trim()===""?[]:gc([Ce({content:c,isMeta:!0})]))('
    );
  });
});

describe('a body that renders to nothing emits nothing: static bodies keep the plain wrapper call, and suppression is unchanged', () => {
  it('static bodies keep the plain wrapper call, and suppression is unchanged', () => {
    const out = taskListReminder.apply(TASK_2291, 'Static text only.', false)!;
    expect(out).toContain(
      'return Wa([Mk({content:`Static text only.`,isMeta:!0})])'
    );
    expect(
      runCase(
        taskListReminder.apply(TASK_2291, '', true)!,
        'task_reminder'
      )({ content: [] })
    ).toEqual([]);
  });
});

describe('review fixes: [P1] an .md still holding an earlier stock body is a no-op', () => {
  it('[P1] an .md still holding an earlier stock body is a no-op', () => {
    const oldMcp = mcpInstructions.previousDefaultBodies!.find(b =>
      b.includes('{{added_blocks}}')
    )!;
    expect(
      mcpInstructions.apply(MCP_2291, sub('mcp-instructions', oldMcp), false)
    ).toBe(MCP_2291);
    const oldAgent = 'Available agent types for the Agent tool:\n{{listing}}';
    expect(agentListing.previousDefaultBodies).toContain(oldAgent);
    expect(
      agentListing.apply(AGENT_2291, sub('agent-listing', oldAgent), false)
    ).toBe(AGENT_2291);
    expect(
      mcpInstructions.apply(
        MCP_2291,
        sub('mcp-instructions', oldMcp + ' x'),
        false
      )
    ).not.toBe(MCP_2291);
  });
});

describe('review fixes: [P2] an edited pdf stub stays correct on null-count and refused branches', () => {
  it('[P2] an edited pdf stub stays correct on null-count and refused branches', () => {
    const edited = pdfRef.defaultBody.replace('Maximum 20', 'At most 20');
    const out = pdfRef.apply(
      MOCK_PDF_BLOCK,
      sub('pdf-reference', edited),
      false
    )!;
    const start = out.indexOf('pdf_reference:');
    const fn = new Function(
      'ou',
      'Mt',
      'nt',
      'P',
      'gc',
      'Ce',
      `return ({${out.slice(start, out.indexOf(',selected_lines_in_ide:'))}}).pdf_reference`
    )(
      (x: string) => x,
      (x: number) => `${x}B`,
      'Read',
      (n: number, w: string) => (n === 1 ? w : w + 's'),
      (x: unknown) => x,
      (o: { content: string }) => o.content
    ) as (e: Record<string, unknown>) => string[];
    const nullCount = fn({ filename: 'a', fileSize: 9, pageCount: null })[0];
    expect(nullCount).toContain('(page count unknown, 9B)');
    expect(nullCount).not.toContain('null');
    const refused = fn({
      filename: 'a',
      fileSize: 9,
      pageCount: 7,
      wholeRefusedByModel: true,
    })[0];
    expect(refused).toContain('No PDF; pages: "1-7".');
    expect(refused).not.toContain('too large');
    expect(fn({ filename: 'a', fileSize: 9, pageCount: 7 })[0]).toContain(
      'This PDF is too large to read all at once.'
    );
    expect(
      pdfRef.apply(
        MOCK_PDF_BLOCK,
        sub('pdf-reference', pdfRef.previousDefaultBodies![0]),
        false
      )
    ).toBe(MOCK_PDF_BLOCK);
  });
});

describe('review fixes: keeps the memory update ambient suffix when re-splicing', () => {
  it('keeps the memory update ambient suffix when re-splicing', () => {
    const once = memoryUpdate.apply(
      MEMORY_2291,
      sub('memory-update', '{{summary}}\n{{ambient_note}}'),
      false
    )!;
    expect(once).toContain('return g.push(AMB),');
  });
});

describe('review fixes: [P2] the router finds the client-side loop however far it sits', () => {
  it('[P2] the router finds the client-side loop however far it sits', () => {
    const router = REMINDER_REGISTRY.find(
      r => r.id === 'mcp-per-server-router'
    )!;
    const filler = 'let pad=`' + 'x'.repeat(2000) + '`;';
    const zje =
      'function Zje(e,n){let r=new Map;for(let g of e)if(g.instructions)r.set(g.name,`## ${g.name}\n${g.instructions}`);' +
      filler +
      'let s=new Set(e.map((g)=>g.name));for(let g of n){if(!s.has(g.serverName))continue;r.set(g.serverName,g.block)}return r}' +
      'function other(n){for(let g of n){if(!q.has(g.serverName))continue}}';
    const out = router.apply(zje, router.defaultBody, false)!;
    expect(out).toContain(
      'for(let g of n){if(__tweakccMcpOverride(g.serverName,"")===null)continue;if(!s.has('
    );
    expect(out).toContain('function other(n){for(let g of n){if(!q.has(');
  });
});

describe('review fixes: [P3] stock comparison keeps meaningful whitespace and folds CRLF', () => {
  it('[P3] stock comparison keeps meaningful whitespace and folds CRLF', () => {
    const mention = REMINDER_REGISTRY.find(r => r.id === 'agent-mention')!;
    const stock = sub('agent-mention', mention.defaultBody);
    expect(stock.endsWith(' ')).toBe(true);
    const DUMMY = 'no handler';
    expect(mention.apply(DUMMY, stock, false)).toBe(DUMMY);
    expect(mention.apply(DUMMY, stock.trimEnd(), false)).toBeNull();
    const mcpStock = sub('mcp-instructions', mcpInstructions.defaultBody);
    expect(
      mcpInstructions.apply(
        MCP_2291,
        mcpStock.replace(/\n/g, '\r\n') + '\r\n',
        false
      )
    ).toBe(MCP_2291);
  });
});

describe('earlier memory bodies remain unchanged', () => {
  it.each(memoryUpdate.previousDefaultBodies!)(
    'leaves a prior stock body unchanged',
    old =>
      expect(
        memoryUpdate.apply(MEMORY_2291, sub('memory-update', old), false)
      ).toBe(MEMORY_2291)
  );
});

describe('second review fixes: a CRLF-saved .md renders single line breaks and drops blank lines cleanly', () => {
  it('a CRLF-saved .md renders single line breaks and drops blank lines cleanly', () => {
    const md =
      '<!--\r\nname: MCP\r\n-->\r\nIntro\r\n\r\n{{added_section}}\r\n\r\n{{removed_section}}\r\nEnd\r\n';
    const parsed = parseReminderMarkdown('mcp-instructions', md);
    expect(parsed.body).not.toContain('\r');
    const r = runCase(
      mcpInstructions.apply(
        MCP_2291,
        sub('mcp-instructions', parsed.body),
        false
      )!,
      'mcp_instructions_delta'
    );
    expect(
      r({ addedBlocks: ['## a\nA'], addedNames: ['a'], removedNames: [] })
    ).toBe(
      'Intro\n\n# MCP Server Instructions\n\nThe following MCP servers have provided instructions for how to use their tools and resources:\n\n## a\nA\n\nEnd'
    );
  });
});
