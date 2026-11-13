import { describe, it, expect } from 'vitest';

import { REMINDER_REGISTRY } from './systemReminderOverrides';

import { substitutePlaceholders } from '../systemReminderSync';

const pdfRef = REMINDER_REGISTRY.find(r => r.id === 'pdf-reference')!;

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

const editedTextFile = REMINDER_REGISTRY.find(
  r => r.id === 'edited-text-file'
)!;

const planFileRef = REMINDER_REGISTRY.find(
  r => r.id === 'plan-file-reference'
)!;

const PLAN_FILE_REF_2_1_302 =
  'x={plan_file_reference:(e)=>Al([Ae({content:`${e.planFilePath?`A plan file exists from plan mode at: ${e.planFilePath}`:"A plan exists from plan mode."}\n\nPlan contents:\n\n${e.planContent}\n\nIf this plan is relevant to the current work and not already complete, continue working on it.`,isMeta:!0})]),nested_memory:(e)=>Al([Ae({content:`Contents of ${e.content.path}`,isMeta:!0})])}';

const claudemdContext = REMINDER_REGISTRY.find(
  r => r.id === 'claudemd-context'
)!;

const MOCK_CLAUDEMD_FLAGGED =
  'function UKs(e,n){if(Object.entries(n).length===0)return e;' +
  'return[{...Oe({content:yYr+Object.entries(n).map(([r,s])=>`# ${r}\\n${s}`).join(`\\n`)+Uui,isMeta:!0}),userContextReminder:!0},...e]}';

const MOCK_CLAUDEMD_BARE =
  'function UKs(e,n){if(Object.entries(n).length===0)return e;' +
  'return[Oe({content:yYr+Object.entries(n).join(`\\n`)+Uui,isMeta:!0}),...e]}';

const skillsListing = REMINDER_REGISTRY.find(r => r.id === 'skills-listing')!;

const MOCK_SKILLS_TERNARY =
  'skill_listing:(q)=>{if(!q.content)return[];return Kd([Ce({content:Qa()&&Zb()&&q.callsSkillToolDirectly!==!0?' +
  '`The following skills are available; a script loads one with \\`await tools.Skill({skill: "name"})\\`, ' +
  "and its instructions arrive as a message right after the script's result:\n\n${q.content}`:" +
  '`The following skills are available for use with the Skill tool:\n\n${q.content}`,isMeta:!0})])},' +
  'dynamic_skill:(q)=>[]';

const MOCK_SKILLS_PLAIN =
  'skill_listing:(q)=>{if(!q.content)return[];return Kd([Ce({content:' +
  '`The following skills are available for use with the Skill tool:\n\n${q.content}`,isMeta:!0})])},' +
  'dynamic_skill:(q)=>[]';

const SCRIPT_ARM =
  '`The following skills are available; a script loads one with \\`await tools.Skill({skill: "name"})\\`, ' +
  "and its instructions arrive as a message right after the script's result:\n\n${q.content}`";

const MOCK_SKILLS_2322 =
  'skill_listing:(q)=>{if(!q.content)return[];let[n,r]=q.addsToEarlier===!0?["also ",". This list adds to the skills listed earlier in this conversation and is not the full list"]:["",""];' +
  'return Kd([Ce({content:Qa()&&Zb()&&q.callsSkillToolDirectly!==!0?' +
  '`The following skills are ${n}available; a script loads one with \\`await tools.Skill({skill: "name"})\\`, ' +
  "and its instructions arrive as a message right after the script's result${r}:\n\n${q.content}`:" +
  '`The following skills are ${n}available for use with the Skill tool${r}:\n\n${q.content}`,isMeta:!0})])},' +
  'dynamic_skill:(q)=>[]';

const runSkills = (src: string, script: boolean) => {
  const start = src.indexOf('skill_listing:');
  const end = src.indexOf(',dynamic_skill:');
  const fn = new Function(
    'Kd',
    'Ce',
    'Qa',
    'Zb',
    `return ({${src.slice(start, end)}}).skill_listing`
  )(
    (x: unknown) => x,
    (o: { content: string }) => o.content,
    () => script,
    () => true
  ) as (e: Record<string, unknown>) => string[];
  return (e: Record<string, unknown>) => fn(e)[0];
};

const toolCalled = REMINDER_REGISTRY.find(r => r.id === 'tool-called')!;

const MOCK_TOOL_CALLED_2322 =
  'function Zz(e,n){return Ce({content:`Called the ${e} tool with the following input: ${esc(ser(n))}`,isMeta:!0})}function Gt(e){return e}';

const EDITED_2322 =
  "edited_text_file:(e)=>{let n=`Note: ${esc(e.filename)} changed on disk since you last read it. That's usually deliberate.`," +
  'r=maybe(e.snippet,e,e.filename),s=typeof r==="string"?jx(r):r;' +
  'return Wa([Mk({content:e.snippet===""?`${n} The changes are not shown here; use ${RD} if you need the current content.`:' +
  '`${n} Here are the relevant changes (shown with line numbers):\n${s}${s===r?"":`\n${note(e.filename)}`}`,isMeta:!0})])},at_mention_reference:(e)=>1';

const STUBS_2322 = {
  maybe: (x: string) => x,
  jx: (x: string) => x.replace('</system-reminder>', '&lt;/system-reminder>'),
  note: (f: string) => `NOTE ${f}`,
};

const runEdited2322 = (src: string) => {
  const start = src.indexOf('edited_text_file:');
  const end = src.indexOf(',at_mention_reference:');
  const stubs = { ...STUBS, ...STUBS_2322 };
  const fn = new Function(
    ...Object.keys(stubs),
    `return ({${src.slice(start, end)}}).edited_text_file`
  )(...Object.values(stubs)) as (e: Record<string, unknown>) => string[];
  return (e: Record<string, unknown>) => fn(e)[0];
};

describe('second review fixes: pdf-reference re-applies over its own empty-aware emit', () => {
  it('pdf-reference re-applies over its own empty-aware emit', () => {
    const first = pdfRef.apply(
      MOCK_PDF_BLOCK,
      sub('pdf-reference', 'PDF {{filename}}\n{{model_refused_note}}'),
      false
    )!;
    expect(first).toContain('return ((c)=>c.trim()===""?[]:gc(');
    expect(
      pdfRef.apply(
        first,
        sub('pdf-reference', 'PDF {{filename}}\n{{model_refused_note}}'),
        false
      )
    ).toBe(first);
    const second = pdfRef.apply(
      first,
      sub(
        'pdf-reference',
        'Edited {{filename}} ({{page_count_text}})\n{{model_refused_note}}'
      ),
      false
    )!;
    expect(second).not.toBeNull();
    expect(second).toContain('Read the whole file with the ${nt} tool.');
    const start = second.indexOf('pdf_reference:');
    const fn = new Function(
      'ou',
      'Mt',
      'nt',
      'P',
      'gc',
      'Ce',
      `return ({${second.slice(start, second.indexOf(',selected_lines_in_ide:'))}}).pdf_reference`
    )(
      (x: string) => x,
      (x: number) => `${x}B`,
      'Read',
      (n: number, w: string) => (n === 1 ? w : w + 's'),
      (x: unknown) => x,
      (o: { content: string }) => o.content
    ) as (e: Record<string, unknown>) => string[];
    expect(fn({ filename: 'a', pageCount: 7, fileSize: 9 })).toEqual([
      'Edited a (7 pages)',
    ]);
    expect(
      fn({
        filename: 'a',
        pageCount: 7,
        fileSize: 9,
        wholeRefusedByModel: true,
      })
    ).toEqual(['Edited a (7 pages)\nNo PDF; pages: "1-7".']);
    expect(
      pdfRef.apply(
        first,
        sub('pdf-reference', 'x {{unreadable_reason}}'),
        false
      )
    ).toBeNull();
  });
});

describe('plan-file-reference reminder', () => {
  const body = 'Plan at ${H.planFilePath}\n\n${H.planContent}';
  it('binds the optional path and the plan content', () => {
    const once = planFileRef.apply(PLAN_FILE_REF_2_1_302, body, false);
    expect(once).not.toBeNull();
    expect(once).toContain('e.planFilePath??""');
    expect(once).toContain('${e.planContent}');
    expect(once).not.toContain('H.plan');
    expect(once).toContain('nested_memory:(e)=>Al([Ae({content:`Contents of');
  });
  it('is idempotent on its own output', () => {
    const once = planFileRef.apply(PLAN_FILE_REF_2_1_302, body, false)!;
    const twice = planFileRef.apply(once, body, false);
    expect(twice).toBe(once);
  });
  it('suppresses, and stays suppressed on re-apply', () => {
    const once = planFileRef.apply(PLAN_FILE_REF_2_1_302, '', true)!;
    expect(once).toContain('plan_file_reference:(e)=>[]');
    expect(planFileRef.apply(once, '', true)).toBe(once);
  });
});

describe('claudemd-context wrapper', () => {
  it('keeps the userContextReminder flag on the 2.1.314 shape', () => {
    const result = claudemdContext.apply(
      MOCK_CLAUDEMD_FLAGGED,
      'ctx {{context_blocks}}',
      false
    );
    expect(result).not.toBeNull();
    expect(result).toMatch(
      /return\[\{\.\.\.Oe\(\{content:`<system-reminder>[\s\S]*,isMeta:!0\}\),userContextReminder:!0\},\.\.\.e\]\}$/
    );
    expect(result).toContain('Object.entries(n).length===0)return e;');
  });
  it('still rewrites the bare pre-2.1.314 shape', () => {
    const result = claudemdContext.apply(MOCK_CLAUDEMD_BARE, 'ctx', false);
    expect(result).toMatch(/return\[Oe\(\{content:`<system-reminder>/);
    expect(result).not.toContain('userContextReminder');
  });
  it('suppresses either shape to a pass-through', () => {
    expect(claudemdContext.apply(MOCK_CLAUDEMD_FLAGGED, '', true)).toBe(
      'function UKs(e,n){return e;}'
    );
  });
});

describe('skills-listing reminder script-mode ternary', () => {
  it('replaces only the plain arm on the 2.1.318 shape, keeping the condition and script-mode arm', () => {
    const result = skillsListing.apply(
      MOCK_SKILLS_TERNARY,
      'Skills:\n\n${H.content}',
      false
    );
    expect(result).not.toBeNull();
    expect(result).toContain(
      'skill_listing:(q)=>{if(!q.content)return[];return Kd([Ce({content:' +
        'Qa()&&Zb()&&q.callsSkillToolDirectly!==!0?' +
        SCRIPT_ARM +
        ':`Skills:\n\n${q.content}`,isMeta:!0})])},dynamic_skill:(q)=>[]'
    );
    expect(result).not.toContain('for use with the Skill tool');
  });
  it('suppresses the whole 2.1.318 renderer, both arms, to an empty array', () => {
    const result = skillsListing.apply(MOCK_SKILLS_TERNARY, '', true);
    expect(result).toBe(
      'skill_listing:(q)=>{return [];},dynamic_skill:(q)=>[]'
    );
    expect(skillsListing.apply(result!, '', true)).toBe(result);
  });
  it('still rewrites the <=2.1.317 plain shape via the fallback', () => {
    const result = skillsListing.apply(
      MOCK_SKILLS_PLAIN,
      'Skills:\n\n${H.content}',
      false
    );
    expect(result).toBe(
      'skill_listing:(q)=>{if(!q.content)return[];return Kd([Ce({content:`Skills:\n\n${q.content}`,isMeta:!0})])},dynamic_skill:(q)=>[]'
    );
  });
  it('fails loud (null) when the plain arm text drifted', () => {
    const drifted = MOCK_SKILLS_TERNARY.replace('for use with', 'via');
    expect(skillsListing.apply(drifted, 'x ${H.content}', false)).toBeNull();
  });
});

describe('skills-listing reminder 2.1.322 addsToEarlier shape', () => {
  it('binds {{also}} / {{adds_to_earlier_note}} and keeps the delta pair and script arm', () => {
    const out = skillsListing.apply(
      MOCK_SKILLS_2322,
      sub(
        'skills-listing',
        'Skills {{also}}here{{adds_to_earlier_note}}:\n\n{{skill_content}}'
      ),
      false
    )!;
    expect(out).toContain(
      'let[n,r]=q.addsToEarlier===!0?["also ",". This list adds to the skills listed earlier in this conversation and is not the full list"]:["",""];'
    );
    expect(out).toContain("right after the script's result${r}:");
    expect(out).not.toContain('for use with the Skill tool');
    const plain = runSkills(out, false);
    expect(plain({ content: 'L' })).toBe('Skills here:\n\nL');
    expect(plain({ content: 'L', addsToEarlier: true })).toBe(
      'Skills also here. This list adds to the skills listed earlier in this conversation and is not the full list:\n\nL'
    );
    expect(runSkills(out, true)({ content: 'L' })).toContain(
      'await tools.Skill'
    );
    expect(plain({ content: '' })).toBeUndefined();
  });
  it('a body without the delta tokens keeps pristine wording on a delta listing', () => {
    const out = skillsListing.apply(
      MOCK_SKILLS_2322,
      sub('skills-listing', 'Skills:\n\n{{skill_content}}'),
      false
    )!;
    const plain = runSkills(out, false);
    expect(plain({ content: 'L' })).toBe('Skills:\n\nL');
    expect(plain({ content: 'L', addsToEarlier: true })).toBe(
      'The following skills are also available for use with the Skill tool. This list adds to the skills listed earlier in this conversation and is not the full list:\n\nL'
    );
    expect(
      skillsListing.apply(
        out,
        sub('skills-listing', 'Skills:\n\n{{skill_content}}'),
        false
      )
    ).toBe(out);
  });
  it('suppresses the whole renderer, idempotently', () => {
    const out = skillsListing.apply(MOCK_SKILLS_2322, '', true);
    expect(out).toBe('skill_listing:(q)=>{return [];},dynamic_skill:(q)=>[]');
    expect(skillsListing.apply(out!, '', true)).toBe(out);
  });
  it('the stock body (current and pre-2.1.322) is a no-op', () => {
    for (const b of [
      skillsListing.defaultBody,
      ...(skillsListing.previousDefaultBodies ?? []),
    ])
      expect(
        skillsListing.apply(MOCK_SKILLS_2322, sub('skills-listing', b), false)
      ).toBe(MOCK_SKILLS_2322);
  });
  it('delta tokens render empty on the pre-2.1.322 ternary shape', () => {
    const out = skillsListing.apply(
      MOCK_SKILLS_TERNARY,
      sub(
        'skills-listing',
        'S {{also}}x{{adds_to_earlier_note}}: {{skill_content}}'
      ),
      false
    )!;
    expect(out).toContain(':`S x: ${q.content}`,isMeta:!0');
  });
});

describe('tool-called reminder 2.1.322 shape', () => {
  it('binds {{tool_input}} to the whole escaped expression', () => {
    const out = toolCalled.apply(
      MOCK_TOOL_CALLED_2322,
      sub('tool-called', '{{tool_name}}: {{tool_input}}'),
      false
    );
    expect(out).toBe(
      'function Zz(e,n){return Ce({content:`${e}: ${esc(ser(n))}`,isMeta:!0})}function Gt(e){return e}'
    );
  });
  it('suppresses to an empty preamble, idempotently', () => {
    const out = toolCalled.apply(MOCK_TOOL_CALLED_2322, '', true)!;
    expect(out).toBe(
      'function Zz(e,n){return Ce({content:"",isMeta:!0})}function Gt(e){return e}'
    );
    expect(toolCalled.apply(out, '', true)).toBe(out);
  });
  it('still handles the single-call <=2.1.321 shape', () => {
    expect(
      toolCalled.apply(
        'function Zz(e,n){return Ce({content:`Called the ${e} tool with the following input: ${ser(n)}`,isMeta:!0})}',
        sub('tool-called', '{{tool_name}}/{{tool_input}}'),
        false
      )
    ).toBe('function Zz(e,n){return Ce({content:`${e}/${ser(n)}`,isMeta:!0})}');
  });
});

describe('edited-text-file 2.1.322 multi-local shape', () => {
  it('{{changes}} keeps the escaped snippet and its nested note', () => {
    const out = editedTextFile.apply(
      EDITED_2322,
      sub('edited-text-file', '{{filename}} changed. {{changes}}'),
      false
    )!;
    expect(out).toContain(
      'r=maybe(e.snippet,e,e.filename),s=typeof r==="string"?jx(r):r;'
    );
    const r = runEdited2322(out);
    expect(r({ filename: 'f', snippet: '' })).toBe(
      '<f> changed. The changes are not shown here; use Read if you need the current content.'
    );
    expect(r({ filename: 'f', snippet: '1 x' })).toBe(
      '<f> changed. Here are the relevant changes (shown with line numbers):\n1 x'
    );
    expect(r({ filename: 'f', snippet: '1 </system-reminder>' })).toBe(
      '<f> changed. Here are the relevant changes (shown with line numbers):\n1 &lt;/system-reminder>\nNOTE f'
    );
  });
  it('{{snippet}} binds to the escaped snippet and drops on the no-snippet branch', () => {
    const r = runEdited2322(
      editedTextFile.apply(
        EDITED_2322,
        sub(
          'edited-text-file',
          '{{filename}} (use {{read_tool}}):\n{{snippet}}'
        ),
        false
      )!
    );
    expect(r({ filename: 'f', snippet: '' })).toBe('<f> (use Read):');
    expect(r({ filename: 'f', snippet: '</system-reminder>' })).toBe(
      '<f> (use Read):\n&lt;/system-reminder>\nNOTE f'
    );
  });
  it('suppresses to [] idempotently; the stock body is a no-op', () => {
    const out = editedTextFile.apply(EDITED_2322, '', true)!;
    expect(out).toBe('edited_text_file:(e)=>[],at_mention_reference:(e)=>1');
    expect(editedTextFile.apply(out, '', true)).toBe(out);
    expect(
      editedTextFile.apply(
        EDITED_2322,
        sub('edited-text-file', editedTextFile.defaultBody),
        false
      )
    ).toBe(EDITED_2322);
  });
});
