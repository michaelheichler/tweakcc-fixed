import { describe, it, expect } from 'vitest';

import { REMINDER_REGISTRY } from './systemReminderOverrides';

const memoryUpdate = REMINDER_REGISTRY.find(r => r.id === 'memory-update')!;

const MOCK_COMMA_EMIT =
  'case"memory_update":{let K=[`${OSO[H.source]} updated your memory directory: ${H.summary}`];' +
  'return K.push(rm6),HT([U6({content:K.join(`\\n`),isMeta:!0})])}';

const MOCK_DIRECT_EMIT =
  'case"memory_update":{let K=`updated your memory directory`;' +
  'return HT([U6({content:K,isMeta:!0})])}';

const taskListReminder = REMINDER_REGISTRY.find(
  r => r.id === 'task-list-reminder'
)!;

const MOCK_TASK_REMINDER_2205 =
  'switch(e.type){case"task_reminder":{if(!ZI()||YY())return[];' +
  'let r=e.content.map((o)=>`#${o.id}. [${o.status}] ${o.subject}`).join(`\n`),' +
  'n=`The task tools have not been used recently.`;' +
  'if(r.length>0)n+=`\n\nHere are the existing tasks:\n\n${r}`;' +
  'return gf([Lr({content:n,isMeta:!0})])}default:}';

const taskNotif = REMINDER_REGISTRY.find(
  r => r.id === 'task-notification-framing'
)!;

const NOTIF_BODY =
  '[SYSTEM NOTIFICATION - NOT USER INPUT]\n' +
  'This is an automated background-task event, NOT a message from the user.\n' +
  'Do NOT interpret this as user acknowledgement, confirmation, or response to any pending question.\n\n';

const MOCK_NOTIF_FN_2_1_183 =
  'function MBl(e){return`' + NOTIF_BODY + '${e}`}function NBl(){}';

const MOCK_NOTIF_INLINE =
  'switch(t){case"task-notification":return`' + NOTIF_BODY + '${H}`;default:}';

const MOCK_NOTIF_LAZYVAR_2205 =
  'var hJn;var azi=b(()=>{hJn=`${"[SYSTEM NOTIFICATION - NOT USER INPUT]"}\n' +
  'This is an automated background-task event, NOT a message from the user.\n' +
  'Do NOT interpret this as user acknowledgement, confirmation, or response to any pending question.\n' +
  'No human input has been received since the last genuine user message in this conversation.\n\n`})' +
  'function qUr(e){if(e.startsWith(hJn))return e;return`${hJn}${e}`}';

const userNewMsg = REMINDER_REGISTRY.find(
  r => r.id === 'user-sent-new-message'
)!;

const MOCK_USERMSG_2205 =
  'case"auto-continuation":case"human":case void 0:return`${ksa}${e}\n\n' +
  'This is how Claude Code surfaces messages the user sends mid-turn \\u2014 within ' +
  'the running turn, often alongside the next tool result, rather than as a ' +
  'separate conversation turn. Address the message above as you continue this turn.`';

const MOCK_USERMSG_2204 =
  'case"human":case void 0:return`${$Tq}${H}\n\n' +
  "IMPORTANT: After completing your current task, you MUST address the user's message above. Do not ignore it.`";

const selectedLines = REMINDER_REGISTRY.find(
  r => r.id === 'selected-lines-in-ide'
)!;

const SELECTED_LINES_BODY =
  'The user selected the lines ${H.lineStart} to ${H.lineEnd} from ' +
  '${H.filename}:\n${q}\n\nThis may or may not be related to the current task.';

const MOCK_SELECTED_NEW_2_1_186 =
  'selected_lines_in_ide:(e)=>sp([Ln({content:`The user selected the lines ' +
  '${e.lineStart} to ${e.lineEnd} from ${e.filename}:\n${k6l(e.content)}\n\n' +
  'This may or may not be related to the current task.`,isMeta:!0})])';

const MOCK_SELECTED_OLD_2_1_185 =
  'selected_lines_in_ide:(H)=>{let q=H.content.length>2000?' +
  'H.content.substring(0,2000)+`\n... (truncated)`:H.content;' +
  'return o5([j6({content:`The user selected the lines ${H.lineStart} to ' +
  '${H.lineEnd} from ${H.filename}:\n${q}\n\nThis may or may not be related ' +
  'to the current task.`,isMeta:!0})])}';

const MOCK_SELECTED_DIFF_SIBLING =
  'selected_lines_in_diff:(e)=>sp([Ln({content:`The user selected the ' +
  'following ${e.lineCount} ${e.lineCount===1?"line":"lines"} from the diff ' +
  'view:\n${k6l(e.content)}\n\nThis may or may not be related to the current ' +
  'task.`,isMeta:!0})])';

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

describe('memory-update reminder wrapper discovery', () => {
  it('reads the real wrapper/ctor past a comma-expression, not the o5/j6 fallback', () => {
    const result = memoryUpdate.apply(MOCK_COMMA_EMIT, 'memory changed', false);
    expect(result).not.toBeNull();
    expect(result).toContain('HT([U6({content:');
    expect(result).not.toContain('o5([j6(');
  });
  it('still reads a wrapper emitted directly after return', () => {
    const result = memoryUpdate.apply(
      MOCK_DIRECT_EMIT,
      'memory changed',
      false
    );
    expect(result).not.toBeNull();
    expect(result).toContain('HT([U6({content:');
  });
  it('binds the pre-2.1.288 map-read source label by shape', () => {
    const result = memoryUpdate.apply(
      MOCK_COMMA_EMIT,
      'By ${H.sourceLabel}: ${H.summary}',
      false
    );
    expect(result).toContain('content:`By ${OSO[H.source]}: ${H.summary}`');
  });
});

describe('task-list-reminder feature-gate guard', () => {
  it("keeps the 2.1.205 two-clause guard verbatim and binds {{tasks}} to the case's own list", () => {
    const result = taskListReminder.apply(
      MOCK_TASK_REMINDER_2205,
      'Tasks:\n\n${q}',
      false
    );
    expect(result).not.toBeNull();
    expect(result).toContain('{if(!ZI()||YY())return[];let r=e.content.map(');
    expect(result).not.toContain('if(!GX())');
    expect(result).toContain('`Tasks:`,``,[`${r}`,``]');
  });
  it('still handles the single-clause guard shape', () => {
    const single = MOCK_TASK_REMINDER_2205.replace(
      'if(!ZI()||YY())',
      'if(!ZI())'
    );
    const result = taskListReminder.apply(single, 'Tasks:\n\n${q}', false);
    expect(result).not.toBeNull();
    expect(result).toContain('if(!ZI())return[]');
  });
  it('keeps a guard of any shape, since the preamble is never re-emitted', () => {
    const drifted = MOCK_TASK_REMINDER_2205.replace(
      'if(!ZI()||YY())return[]',
      'if(someBareCond)return[]'
    );
    expect(taskListReminder.apply(drifted, 'Tasks:\n\n${q}', false)).toContain(
      '{if(someBareCond)return[];'
    );
  });
});

describe('task-notification-framing wrapper discovery', () => {
  it('rewrites the 2.1.183 standalone framing function in place, preserving ${param} and the `}` suffix', () => {
    const result = taskNotif.apply(MOCK_NOTIF_FN_2_1_183, 'PREFIX ${H}', false);
    expect(result).not.toBeNull();
    expect(result).toContain('function MBl(e){return`PREFIX ${e}`}');
    expect(result).toContain('function NBl(){}');
  });
  it('still rewrites the <=2.1.182 inline case shape', () => {
    const result = taskNotif.apply(MOCK_NOTIF_INLINE, 'PREFIX ${H}', false);
    expect(result).not.toBeNull();
    expect(result).toContain('case"task-notification":return`PREFIX ${H}`;');
  });
  it('suppresses to a bare `${param}` on the function shape (empty body)', () => {
    const result = taskNotif.apply(MOCK_NOTIF_FN_2_1_183, '${H}', true);
    expect(result).toContain('function MBl(e){return`${e}`}');
  });
  it('fails loud (null) when the framing body text changed', () => {
    const drifted = 'function MBl(e){return`[DIFFERENT FRAMING]\n${e}`}';
    expect(taskNotif.apply(drifted, 'x ${H}', false)).toBeNull();
  });
  it('rewrites the 2.1.205 lazy framing var in place, stripping the appended-message placeholder and leaving qUr untouched', () => {
    const result = taskNotif.apply(
      MOCK_NOTIF_LAZYVAR_2205,
      'MY FRAMING\n\n${H}',
      false
    );
    expect(result).not.toBeNull();
    expect(result).toContain('hJn=`MY FRAMING\n\n`');
    expect(result).toContain(
      'function qUr(e){if(e.startsWith(hJn))return e;return`${hJn}${e}`}'
    );
  });
  it('suppresses the 2.1.205 lazy framing var to an empty template (empty body)', () => {
    const result = taskNotif.apply(MOCK_NOTIF_LAZYVAR_2205, '${H}', true);
    expect(result).not.toBeNull();
    expect(result).toContain('hJn=``');
  });
});

describe('user-sent-new-message wrapper discovery', () => {
  it('rewrites the 2.1.205 reworded mid-turn framing, capturing the message var', () => {
    const result = userNewMsg.apply(MOCK_USERMSG_2205, 'MSG ${H}', false);
    expect(result).not.toBeNull();
    expect(result).toContain(
      'case"auto-continuation":case"human":case void 0:return`MSG ${e}`'
    );
  });
  it('still rewrites the <=2.1.204 imperative framing via the trailing alternation', () => {
    const result = userNewMsg.apply(MOCK_USERMSG_2204, 'MSG ${H}', false);
    expect(result).not.toBeNull();
    expect(result).toContain('case"human":case void 0:return`MSG ${H}`');
  });
  it('suppresses to a bare message var (empty body)', () => {
    const result = userNewMsg.apply(MOCK_USERMSG_2205, '${H}', true);
    expect(result).not.toBeNull();
    expect(result).toContain('return`${e}`');
  });
  it('fails loud (null) when the framing text drifted', () => {
    const drifted =
      'case"human":case void 0:return`${ksa}${e}\n\n[SOME NEW UNRELATED FRAMING]`';
    expect(userNewMsg.apply(drifted, 'x ${H}', false)).toBeNull();
  });
});

describe('selected-lines-in-ide reminder shape handling: rewrites the 2.1.186 direct-arrow shape, inlining the captured content expression for ${q}', () => {
  it('rewrites the 2.1.186 direct-arrow shape, inlining the captured content expression for ${q}', () => {
    const result = selectedLines.apply(
      MOCK_SELECTED_NEW_2_1_186,
      SELECTED_LINES_BODY,
      false
    );
    expect(result).not.toBeNull();
    expect(result).toBe(MOCK_SELECTED_NEW_2_1_186);
    expect(result).not.toContain('substring(0,2000)');
    expect(result).toContain('${k6l(e.content)}');
  });
});

describe('selected-lines-in-ide reminder shape handling: maps a customized body onto the new shape, preserving the inlined content expression', () => {
  it('maps a customized body onto the new shape, preserving the inlined content expression', () => {
    const custom =
      'SELECTED ${H.lineStart}-${H.lineEnd} in ${H.filename}:\n${q}';
    const result = selectedLines.apply(
      MOCK_SELECTED_NEW_2_1_186,
      custom,
      false
    );
    expect(result).not.toBeNull();
    expect(result).toContain(
      'selected_lines_in_ide:(e)=>sp([Ln({content:`SELECTED ' +
        '${e.lineStart}-${e.lineEnd} in ${e.filename}:\n${k6l(e.content)}`'
    );
  });
});

describe('selected-lines-in-ide reminder shape handling: suppresses the new shape to a bare empty-array arrow', () => {
  it('suppresses the new shape to a bare empty-array arrow', () => {
    const result = selectedLines.apply(
      MOCK_SELECTED_NEW_2_1_186,
      SELECTED_LINES_BODY,
      true
    );
    expect(result).toContain('selected_lines_in_ide:(e)=>[]');
  });
});

describe('selected-lines-in-ide reminder shape handling: round-trips the 2.1.319 multi-argument content wrapper', () => {
  const MOCK_SELECTED_2_1_319 =
    'selected_lines_in_ide:(e)=>mu([Ie({content:`The user selected the lines ' +
    '${e.lineStart} to ${e.lineEnd} from ${nf(e.filename)}:\n' +
    '${wce(mpo(e.content),e,e.filename)}\n\nThis may or may not be related ' +
    'to the current task.`,isMeta:!0})])';
  it('round-trips the 2.1.319 multi-argument content wrapper', () => {
    expect(
      selectedLines.apply(MOCK_SELECTED_2_1_319, SELECTED_LINES_BODY, false)
    ).toBe(MOCK_SELECTED_2_1_319);
  });
});

describe('selected-lines-in-ide reminder shape handling: maps an edited body onto the 2.1.319 shape and re-applies idempotently', () => {
  const MOCK_SELECTED_2_1_319 =
    'selected_lines_in_ide:(e)=>mu([Ie({content:`The user selected the lines ' +
    '${e.lineStart} to ${e.lineEnd} from ${nf(e.filename)}:\n' +
    '${wce(mpo(e.content),e,e.filename)}\n\nThis may or may not be related ' +
    'to the current task.`,isMeta:!0})])';
  it('maps an edited body onto the 2.1.319 shape and re-applies idempotently', () => {
    const custom = 'SEL ${H.filename} ${H.lineStart}-${H.lineEnd}:\n${q}';
    const once = selectedLines.apply(MOCK_SELECTED_2_1_319, custom, false);
    expect(once).toContain(
      'content:`SEL ${nf(e.filename)} ${e.lineStart}-${e.lineEnd}:\n' +
        '${wce(mpo(e.content),e,e.filename)}`'
    );
    expect(selectedLines.apply(once!, custom, false)).toBe(once);
    expect(selectedLines.apply(MOCK_SELECTED_2_1_319 + ';', custom, true)).toBe(
      'selected_lines_in_ide:(e)=>[];'
    );
  });
});

describe('selected-lines-in-ide reminder shape handling: still rewrites the <=2.1.185 truncating shape via the fallback', () => {
  it('still rewrites the <=2.1.185 truncating shape via the fallback', () => {
    const result = selectedLines.apply(
      MOCK_SELECTED_OLD_2_1_185,
      SELECTED_LINES_BODY,
      false
    );
    expect(result).not.toBeNull();
    expect(result).toBe(MOCK_SELECTED_OLD_2_1_185);
  });
});

describe('selected-lines-in-ide reminder shape handling: does not touch the selected_lines_in_diff sibling', () => {
  it('does not touch the selected_lines_in_diff sibling', () => {
    expect(
      selectedLines.apply(
        MOCK_SELECTED_DIFF_SIBLING,
        'Lines ${H.lineStart}-${H.lineEnd}:\n${q}',
        false
      )
    ).toBeNull();
  });
});

describe('verify-plan reminder removed-feature handling', () => {
  const verifyPlan = REMINDER_REGISTRY.find(
    r => r.id === 'verify-plan-reminder'
  )!;
  it('no-ops when the verify-plan case body was removed (CC 2.1.187)', () => {
    const removed =
      'function r(){return["plan_mode_enter","plan_mode_exit","verify_plan_reminder"]}';
    expect(verifyPlan.apply(removed, 'body', false)).toBe(removed);
    expect(verifyPlan.apply(removed, '', true)).toBe(removed);
  });
  it('still fails (null) on real drift when the anchor text is present', () => {
    const drifted =
      'case"other":You have completed implementing the plan but the shape changed';
    expect(verifyPlan.apply(drifted, 'body', false)).toBeNull();
  });
});

describe('pdf-reference reminder composed-expression handling', () => {
  it('matches a ternary+concat `content:` and rebinds every slot from it', () => {
    const result = pdfRef.apply(
      MOCK_PDF_COMPOSED,
      'PDF ${H.filename}: ${H.pageCount} pages, ${l7(H.fileSize)}. Use ${uq}.',
      false
    );
    expect(result).not.toBeNull();
    expect(result).toContain('${ou(e.filename)}');
    expect(result).toContain('${e.pageCount}');
    expect(result).toContain('${Mt(e.fileSize)}');
    expect(result).toContain('${nt}');
    expect(result).not.toContain('page count unknown');
    expect(result).toContain('selected_lines_in_ide:(e)=>gc([Ce({content:`x`');
  });
  it('suppresses the composed shape to an empty emit', () => {
    const result = pdfRef.apply(MOCK_PDF_COMPOSED, '', true);
    expect(result).toContain('pdf_reference:(e)=>[]');
    expect(result).not.toContain('page count unknown');
  });
  it('still handles the pre-2.1.273 single-template shape', () => {
    const result = pdfRef.apply(MOCK_PDF_SIMPLE, 'PDF ${H.filename}.', false);
    expect(result).not.toBeNull();
    expect(result).toContain('${ou(e.filename)}');
  });
});

describe('pdf-reference reminder block-body handling', () => {
  it('rebuilds only the final too-large return and rebinds every slot', () => {
    const result = pdfRef.apply(
      MOCK_PDF_BLOCK,
      'PDF ${H.filename}: ${H.pageCount} pages, ${l7(H.fileSize)}. Use ${uq}.',
      false
    );
    expect(result).not.toBeNull();
    expect(result).toContain(
      'pdf_reference:(e)=>{if("readableWhole"in e&&e.readableWhole)return gc([Ce({content:`PDF file: ${ou(e.filename)}'
    );
    expect(result).toContain('Read the whole file with the ${nt} tool.');
    expect(result).toContain(
      ';return gc([Ce({content:`PDF ${ou(e.filename)}: ${e.pageCount} pages, ${Mt(e.fileSize)}. Use ${nt}.`,isMeta:!0})])},selected_lines_in_ide:'
    );
    expect(result).not.toContain('page count unknown", ');
    expect(result).not.toContain('It may be too long');
  });
  it('suppresses the whole block handler to an empty emit', () => {
    const result = pdfRef.apply(MOCK_PDF_BLOCK, '', true);
    expect(result).toContain(
      'pdf_reference:(e)=>[],selected_lines_in_ide:(e)=>gc('
    );
    expect(result).not.toContain('readableWhole');
  });
  it('is idempotent on its own output', () => {
    const once = pdfRef.apply(MOCK_PDF_BLOCK, 'PDF ${H.filename}.', false)!;
    const twice = pdfRef.apply(once, 'PDF ${H.filename}.', false);
    expect(twice).toBe(once);
  });
});

const compactFileRef = REMINDER_REGISTRY.find(
  r => r.id === 'compact-file-reference'
)!;
const compactBody = 'Note: ${H.filename} is too large. Use ${oO.name}.';
const MOCK_NAME_PROPERTY =
  'compact_file_reference:(e)=>l_([Rn({content:`Note: ${e.filename} was read before the last conversation was summarized, but the contents are too large to include. Use ${oO.name} tool if you need to access it.`,isMeta:!0})])';
const MOCK_BARE_IDENTIFIER =
  'compact_file_reference:(e)=>l_([Rn({content:`Note: ${Nle(e.filename)} was read before the last conversation was summarized, but the contents are too large to include. Use ${As} tool if you need to access it.`,isMeta:!0})])';

describe('compact-time file reference resolves the read-tool slot', () => {
  it('supports the property-name shape', () => {
    const result = compactFileRef.apply(MOCK_NAME_PROPERTY, compactBody, false);
    expect(result).not.toBeNull();
    expect(result).toContain('${oO.name}');
  });

  it('supports the bare-identifier shape', () => {
    const result = compactFileRef.apply(
      MOCK_BARE_IDENTIFIER,
      compactBody,
      false
    );
    expect(result).not.toBeNull();
    expect(result).toContain('${As}');
    expect(result).toContain('${Nle(e.filename)}');
  });
});
