import { showDiff } from './index';

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
  apply: (
    content: string,
    body: string,
    isSuppressed: boolean
  ) => string | null;
}

const findAndReplace = (
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

const simpleEntryPattern = (key: string): RegExp =>
  new RegExp(
    `${key}:\\(([$\\w]+)\\)=>([$\\w]+)\\(\\[([$\\w]+)\\(\\{content:\`((?:[^\`\\\\]|\\\\.)*)\`,isMeta:!0\\}\\)\\]\\)`
  );

const slotExpr = (
  template: string,
  param: string,
  prop: string
): string | null => {
  const m = template.match(
    new RegExp(`\\$\\{((?:[$\\w]+\\()*${param}\\.${prop}\\)*)\\}`)
  );
  return m ? m[1] : null;
};

interface ReminderSlot {
  placeholder: string;
  resolve: (template: string, param: string) => string | null;
}

const propSlot = (placeholder: string, prop: string): ReminderSlot => ({
  placeholder,
  resolve: (template, param) => slotExpr(template, param, prop),
});

const toolNameSlot = (placeholder: string): ReminderSlot => ({
  placeholder,
  resolve: (template, param) =>
    template.match(/\$\{([$\w]+\.name)\}/)?.[1] ??
    template
      .match(/\$\{([$\w]+)\}/g)
      ?.map(x => x.slice(2, -1))
      .find(x => x !== param) ??
    null,
});

interface MatchedEntry {
  index: number;
  length: number;
  hParam: string;
  wrapFn: string;
  metaFn: string;
  template: string;
}

const matchSimpleEntry = (
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

const matchComposedEntry = (
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

const applySimpleEntry = (
  content: string,
  key: string,
  slots: ReminderSlot[],
  body: string,
  isSuppressed: boolean
): string | null => {
  const patchName = key.replace(/_/g, '-');
  const found =
    matchSimpleEntry(content, key) ?? matchComposedEntry(content, key);
  if (!found) {
    if (new RegExp(`${key}:\\([$\\w]+\\)=>\\[\\]`).test(content))
      return content;
    console.error(`patch: reminder ${patchName}: failed to find anchor`);
    return null;
  }
  const { index, length, hParam, wrapFn, metaFn, template } = found;
  let replacement: string;
  if (isSuppressed) {
    replacement = `${key}:(${hParam})=>[]`;
  } else {
    let built = body;
    for (const slot of slots) {
      if (!built.includes(slot.placeholder)) continue;
      const expr = slot.resolve(template, hParam);
      if (expr === null) {
        console.error(
          `patch: reminder ${patchName}: no pristine expression for ${slot.placeholder}`
        );
        return null;
      }
      built = built.split(slot.placeholder).join(`\${${expr}}`);
    }
    replacement = `${key}:(${hParam})=>${wrapFn}([${metaFn}({content:\`${built}\`,isMeta:!0})])`;
  }
  const newContent =
    content.slice(0, index) + replacement + content.slice(index + length);
  showDiff(content, newContent, replacement, index, index + replacement.length);
  return newContent;
};

const matchingBrace = (content: string, openIdx: number): number => {
  if (content[openIdx] !== '{') return -1;
  let depth = 0;
  let inTpl = false;
  let inSingle = false;
  let inDouble = false;
  let inTplExpr = 0;
  for (let i = openIdx; i < content.length; i++) {
    const c = content[i];
    const prev = content[i - 1];
    if (inSingle) {
      if (c === '\\') i++;
      else if (c === "'") inSingle = false;
    } else if (inDouble) {
      if (c === '\\') i++;
      else if (c === '"') inDouble = false;
    } else if (inTpl) {
      if (c === '\\') i++;
      else if (c === '`' && inTplExpr === 0) inTpl = false;
      else if (c === '$' && content[i + 1] === '{') {
        inTplExpr++;
        i++;
      } else if (c === '}' && inTplExpr > 0) {
        inTplExpr--;
      }
    } else if (c === "'" && prev !== '\\') {
      inSingle = true;
    } else if (c === '"' && prev !== '\\') {
      inDouble = true;
    } else if (c === '`' && prev !== '\\') {
      inTpl = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const findCaseBody = (
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

const discoverWrappers = (
  caseBody: string
): {
  arrayWrap: string;
  msgCtor: string;
} => {
  const re = /return\s+[^;]*?([$\w]+)\(\[([$\w]+)\(\{content:/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(caseBody)) !== null) last = m;
  return last
    ? { arrayWrap: last[1], msgCtor: last[2] }
    : { arrayWrap: 'o5', msgCtor: 'j6' };
};

const discoverFeatureGuard = (caseBody: string): string | null => {
  const m = caseBody.match(
    /^\s*if\((!?[$\w]+\(\)(?:(?:\|\||&&)!?[$\w]+\(\))*)\)return\s*\[\]/
  );
  return m ? m[1] : null;
};

const discoverDeltaParam = (caseBody: string, sampleProp: string): string => {
  const m = caseBody.match(new RegExp(`([$\\w]+)\\.${sampleProp}\\b`));
  return m ? m[1] : 'H';
};

export {
  findAndReplace,
  simpleEntryPattern,
  slotExpr,
  ReminderSlot,
  propSlot,
  toolNameSlot,
  MatchedEntry,
  matchSimpleEntry,
  matchComposedEntry,
  applySimpleEntry,
  matchingBrace,
  findCaseBody,
  discoverWrappers,
  discoverFeatureGuard,
  discoverDeltaParam,
};
