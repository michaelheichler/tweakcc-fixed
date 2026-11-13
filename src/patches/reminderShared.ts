import { showDiff } from './index';
import { interpolations, literalEnd, matchingBrace } from './reminderSyntax';
import { resolveSlots, emitReminder } from './reminderRendering';

export interface ReminderApplyResult {
  id: string;
  name: string;
  description: string;
  state: 'default' | 'override' | 'suppressed';
  applied: boolean;
  failed: boolean;
  skipped: boolean;
  details?: string;
}

export interface ReminderInjection {
  id: string;
  name: string;
  description: string;
  placeholders: Record<string, string>;
  defaultBody: string;
  shadows?: string[];
  previousDefaultBodies?: string[];
  bodyIsMarker?: boolean;
  apply: (
    content: string,
    body: string,
    isSuppressed: boolean
  ) => string | null;
}

export const findAndReplace = (
  content: string,
  pattern: RegExp,
  buildReplacement: (match: RegExpMatchArray) => string,
  patchName: string,
  idempotencyCheck?: (content: string) => boolean
): string | null => {
  const match = content.match(pattern);
  if (!match || match.index === undefined) {
    if (idempotencyCheck && idempotencyCheck(content)) return content;
    console.error(`patch: reminder ${patchName}: failed to find anchor`);
    return null;
  }
  const replacement = buildReplacement(match);
  const newContent =
    content.slice(0, match.index) +
    replacement +
    content.slice(match.index + match[0].length);
  showDiff(
    content,
    newContent,
    replacement,
    match.index,
    match.index + match[0].length
  );
  return newContent;
};

export const simpleEntryPattern = (key: string): RegExp =>
  new RegExp(
    `${key}:\\(([$\\w]+)\\)=>([$\\w]+)\\(\\[([$\\w]+)\\(\\{content:\`((?:[^\`\\\\]|\\\\.)*)\`,isMeta:!0\\}\\)\\]\\)`
  );

export const slotExpr = (
  template: string,
  param: string,
  prop: string
): string | null => {
  const m = template.match(
    new RegExp(`\\$\\{((?:[$\\w]+\\()*${param}\\.${prop}\\)*(?:\\?\\?"")?)\\}`)
  );
  if (m) return m[1];
  const ref = new RegExp(`(?:^|[^$\\w.])${param}\\.${prop}(?![$\\w])`);
  const calls = interpolations(template).filter(
    x => /^[$\w]+\(.*\)(?:\?\?"")?$/s.test(x) && ref.test(x)
  );
  return calls.length === 1 ? calls[0] : null;
};

export interface ReminderSlot {
  placeholder: string;
  resolve: (template: string, param: string) => string | null;
  optional?: boolean;
}

export const propSlot = (placeholder: string, prop: string): ReminderSlot => ({
  placeholder,
  resolve: (template, param) => slotExpr(template, param, prop),
});

export const pageCountTextSlot = (placeholder: string): ReminderSlot => ({
  placeholder,
  resolve: (template, param) =>
    template.match(
      new RegExp(
        `\\$\\{(${param}\\.pageCount===null\\?"page count unknown":(?:\`(?:[^\`\\\\]|\\\\.|\\$\\{[^}]*\\})*\`|"[^"]*"))\\}`
      )
    )?.[1] ??
    `${param}.pageCount===null?"page count unknown":${param}.pageCount+(${param}.pageCount===1?" page":" pages")`,
});

export const refusalTernary = (
  template: string,
  param: string
): {
  head: string;
  refused: string;
  otherwise: string;
} | null => {
  const head = `${param}.wholeRefusedByModel?`;
  let emptied: {
    head: string;
    refused: string;
    otherwise: string;
  } | null = null;
  for (const x of interpolations(template)) {
    if (!x.startsWith(head) || x[head.length] !== '`') continue;
    const end = literalEnd(x, head.length);
    if (end < 0 || x[end + 1] !== ':') continue;
    const t = {
      head,
      refused: x.slice(head.length, end + 1),
      otherwise: x.slice(end + 2),
    };
    if (t.otherwise !== '""') return t;
    emptied ??= t;
  }
  return emptied;
};

export const modelRefusedSlot = (placeholder: string): ReminderSlot => ({
  placeholder,
  optional: true,
  resolve: (template, param) => {
    const t = refusalTernary(template, param);
    if (t) return `${t.head}${t.refused}:""`;
    return template.includes('wholeRefusedByModel') ? null : '""';
  },
});

export const unreadableReasonSlot = (placeholder: string): ReminderSlot => ({
  placeholder,
  resolve: (template, param) => {
    const t = refusalTernary(template, param);
    if (t)
      return t.otherwise === '""'
        ? null
        : `${t.head}${t.refused}:${t.otherwise}`;
    return template.includes('wholeRefusedByModel')
      ? null
      : '"This PDF is too large to read all at once."';
  },
});

export const toolNameSlot = (placeholder: string): ReminderSlot => ({
  placeholder,
  resolve: (template, param) =>
    template.match(/\$\{([$\w]+\.name)\}/)?.[1] ??
    template
      .match(/\$\{([$\w]+)\}/g)
      ?.map(x => x.slice(2, -1))
      .find(x => x !== param) ??
    null,
});

export interface MatchedEntry {
  index: number;
  length: number;
  hParam: string;
  wrapFn: string;
  metaFn: string;
  template: string;
  blockPreamble?: string;
}

export const matchSimpleEntry = (
  content: string,
  key: string
): MatchedEntry | null => {
  const m = content.match(simpleEntryPattern(key));
  if (!m || m.index === undefined) return null;
  return {
    index: m.index,
    length: m[0].length,
    hParam: m[1],
    wrapFn: m[2],
    metaFn: m[3],
    template: m[4],
  };
};

export const matchComposedEntry = (
  content: string,
  key: string
): MatchedEntry | null => {
  const head = new RegExp(
    `${key}:\\(([$\\w]+)\\)=>([$\\w]+)\\(\\[([$\\w]+)\\(\\{content:`
  );
  const m = content.match(head);
  if (!m || m.index === undefined) return null;
  const objOpen = m.index + m[0].length - 'content:'.length - 1;
  if (content[objOpen] !== '{') return null;
  const objClose = matchingBrace(content, objOpen);
  if (objClose < 0) return null;
  const tail = ',isMeta:!0';
  const objBody = content.slice(objOpen + 1, objClose);
  if (!objBody.startsWith('content:') || !objBody.endsWith(tail)) return null;
  const close = ')])';
  if (content.slice(objClose + 1, objClose + 1 + close.length) !== close)
    return null;
  return {
    index: m.index,
    length: objClose + 1 + close.length - m.index,
    hParam: m[1],
    wrapFn: m[2],
    metaFn: m[3],
    template: objBody.slice('content:'.length, objBody.length - tail.length),
  };
};

export const matchEmittedEntry = (
  content: string,
  key: string
): MatchedEntry | null => {
  const head = new RegExp(
    `${key}:\\(([$\\w]+)\\)=>\\(\\(c\\)=>c\\.trim\\(\\)===""\\?\\[\\]:([$\\w]+)\\(\\[([$\\w]+)\\(\\{content:c,isMeta:!0\\}\\)\\]\\)\\)\\(`
  );
  const m = content.match(head);
  if (!m || m.index === undefined) return null;
  const argOpen = m.index + m[0].length - 1;
  const argClose = matchingBrace(content, argOpen);
  if (argClose < 0) return null;
  return {
    index: m.index,
    length: argClose + 1 - m.index,
    hParam: m[1],
    wrapFn: m[2],
    metaFn: m[3],
    template: content.slice(argOpen + 1, argClose),
  };
};

export const matchBlockEntry = (
  content: string,
  key: string
): MatchedEntry | null => {
  const head = new RegExp(`${key}:\\(([$\\w]+)\\)=>\\{`);
  const m = content.match(head);
  if (!m || m.index === undefined) return null;
  const bodyOpen = m.index + m[0].length - 1;
  const bodyClose = matchingBrace(content, bodyOpen);
  if (bodyClose < 0) return null;
  const body = content.slice(bodyOpen + 1, bodyClose);
  const returnRe = /return ([$\w]+)\(\[([$\w]+)\(\{content:/g;
  let last: RegExpExecArray | null = null;
  for (let r = returnRe.exec(body); r; r = returnRe.exec(body)) last = r;
  const emittedRe =
    /return ?\(\(c\)=>c\.trim\(\)===""\?\[\]:([$\w]+)\(\[([$\w]+)\(\{content:c,isMeta:!0\}\)\]\)\)\(/g;
  let emitted: RegExpExecArray | null = null;
  for (let r = emittedRe.exec(body); r; r = emittedRe.exec(body)) emitted = r;
  if (emitted && (!last || emitted.index > last.index)) {
    const argOpen = bodyOpen + 1 + emitted.index + emitted[0].length - 1;
    const argClose = matchingBrace(content, argOpen);
    if (argClose !== bodyClose - 1) return null;
    return {
      index: m.index,
      length: bodyClose + 1 - m.index,
      hParam: m[1],
      wrapFn: emitted[1],
      metaFn: emitted[2],
      template:
        body.slice(0, emitted.index) + content.slice(argOpen + 1, argClose),
      blockPreamble: body.slice(0, emitted.index),
    };
  }
  if (!last) return null;
  const objOpen =
    bodyOpen + 1 + last.index + last[0].length - 1 - 'content:'.length;
  if (content[objOpen] !== '{') return null;
  const objClose = matchingBrace(content, objOpen);
  if (objClose < 0) return null;
  const tail = ',isMeta:!0';
  const objBody = content.slice(objOpen + 1, objClose);
  if (!objBody.startsWith('content:') || !objBody.endsWith(tail)) return null;
  if (content.slice(objClose + 1, bodyClose) !== ')])') return null;
  return {
    index: m.index,
    length: bodyClose + 1 - m.index,
    hParam: m[1],
    wrapFn: last[1],
    metaFn: last[2],
    template:
      body.slice(0, last.index) +
      objBody.slice('content:'.length, objBody.length - tail.length),
    blockPreamble: body.slice(0, last.index),
  };
};

export const applySimpleEntry = (
  content: string,
  key: string,
  slots: ReminderSlot[],
  body: string,
  isSuppressed: boolean
): string | null => {
  const patchName = key.replace(/_/g, '-');
  const found =
    matchSimpleEntry(content, key) ??
    matchComposedEntry(content, key) ??
    matchEmittedEntry(content, key) ??
    matchBlockEntry(content, key);
  if (!found) {
    if (new RegExp(`${key}:\\([$\\w]+\\)=>\\[\\]`).test(content))
      return content;
    console.error(`patch: reminder ${patchName}: failed to find anchor`);
    return null;
  }
  const { index, length, hParam, wrapFn, metaFn, template, blockPreamble } =
    found;
  let replacement: string;
  if (isSuppressed) {
    replacement = `${key}:(${hParam})=>[]`;
  } else {
    const resolved = resolveSlots(
      patchName,
      body,
      slots.map(slot => ({
        token: slot.placeholder,
        expr: body.includes(slot.placeholder)
          ? slot.resolve(template, hParam)
          : null,
        optional: slot.optional,
      }))
    );
    if (resolved === null) return null;
    const call = emitReminder(wrapFn, metaFn, body, resolved);
    replacement =
      blockPreamble === undefined
        ? `${key}:(${hParam})=>${call}`
        : `${key}:(${hParam})=>{${blockPreamble}return ${call}}`;
  }
  const newContent =
    content.slice(0, index) + replacement + content.slice(index + length);
  showDiff(content, newContent, replacement, index, index + replacement.length);
  return newContent;
};

export const findCaseBody = (
  content: string,
  caseName: string,
  anchorEnglish: string
): {
  headerIdx: number;
  bodyStart: number;
  bodyEnd: number;
} | null => {
  const caseHeader = `case"${caseName}":{`;
  const occurrences: number[] = [];
  let scan = 0;
  while (true) {
    const idx = content.indexOf(caseHeader, scan);
    if (idx < 0) break;
    occurrences.push(idx);
    scan = idx + caseHeader.length;
  }
  if (occurrences.length === 0) return null;
  const headerIdx = occurrences.find(idx =>
    content.slice(idx, idx + 2048).includes(anchorEnglish)
  );
  if (headerIdx === undefined) return null;
  const bodyStart = headerIdx + caseHeader.length;
  const bodyEnd = matchingBrace(content, bodyStart - 1);
  if (bodyEnd === -1) return null;
  return { headerIdx, bodyStart, bodyEnd };
};

export const discoverWrappers = (
  caseBody: string
): {
  arrayWrap: string;
  msgCtor: string;
} | null => {
  const re = /return\s+[^;]*?([$\w]+)\(\[([$\w]+)\(\{content:/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(caseBody)) !== null) last = m;
  return last ? { arrayWrap: last[1], msgCtor: last[2] } : null;
};

export const discoverDeltaParam = (
  caseBody: string,
  sampleProp: string
): string | null =>
  caseBody.match(new RegExp(`([$\\w]+)\\.${sampleProp}(?![$\\w])`))?.[1] ??
  null;

export const isSuppressedCase = (content: string, key: string): boolean =>
  content.includes(`case"${key}":{return [];}`);
