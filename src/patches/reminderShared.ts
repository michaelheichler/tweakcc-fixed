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
  // Named-prompt ids this built-in override consumes during --apply: it
  // splices the shared cli.js region the named prompt would otherwise anchor
  // on, so the named-prompt pass cannot match a second time. loadShadowSet
  // unions these into the shadow set (alongside runtime .md `shadows:`).
  shadows?: string[];
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

// A reminder-registry entry matched by its KEY and its code SHAPE, never by the
// English prose inside it. Anthropic rewords these bodies freely — CC 2.1.234
// alone rewrote `date_change` and `edited_text_file` and routed every filename
// through a new escaper (`Oie(e.filename)`), which broke six prose-anchored
// regexes at once even though the surrounding code was unchanged. The key
// (`selected_lines_in_ide:` etc.) is unique in the bundle, so it identifies the
// site on its own; the prose only ever existed in these patterns to locate the
// placeholder expressions, and `slotExpr` recovers those from the matched
// template instead.
export const simpleEntryPattern = (key: string): RegExp =>
  new RegExp(
    `${key}:\\(([$\\w]+)\\)=>([$\\w]+)\\(\\[([$\\w]+)\\(\\{content:\`((?:[^\`\\\\]|\\\\.)*)\`,isMeta:!0\\}\\)\\]\\)`
  );

// The full expression a `${…}` slot holds for `<param>.<prop>`, including any
// wrapper calls around it. 2.1.233 emitted `${e.filename}`; 2.1.234 emits
// `${Oie(e.filename)}`. Returning the whole inner expression keeps the override
// bound to whatever CC actually interpolates, so a future wrapper needs no
// further change here.
export const slotExpr = (
  template: string,
  param: string,
  prop: string
): string | null => {
  const m = template.match(
    new RegExp(`\\$\\{((?:[$\\w]+\\()*${param}\\.${prop}\\)*)\\}`)
  );
  return m ? m[1] : null;
};

// A placeholder the override body may contain, and how to recover the
// expression it must be rewritten to from the pristine template.
export interface ReminderSlot {
  // The `${…}` text as it appears in a .md body after substitutePlaceholders.
  placeholder: string;
  // Recovers the replacement expression from the pristine template.
  resolve: (template: string, param: string) => string | null;
}

export const propSlot = (placeholder: string, prop: string): ReminderSlot => ({
  placeholder,
  resolve: (template, param) => slotExpr(template, param, prop),
});

export const applySimpleEntry = (
  content: string,
  key: string,
  slots: ReminderSlot[],
  body: string,
  isSuppressed: boolean
): string | null => {
  const patchName = key.replace(/_/g, '-');
  const match = content.match(simpleEntryPattern(key));
  if (!match || match.index === undefined) {
    if (new RegExp(`${key}:\\([$\\w]+\\)=>\\[\\]`).test(content))
      return content;
    console.error(`patch: reminder ${patchName}: failed to find anchor`);
    return null;
  }
  const [, hParam, wrapFn, metaFn, template] = match;
  let replacement: string;
  if (isSuppressed) {
    replacement = `${key}:(${hParam})=>[]`;
  } else {
    let built = body;
    for (const slot of slots) {
      if (!built.includes(slot.placeholder)) continue;
      const expr = slot.resolve(template, hParam);
      if (expr === null) {
        // Emitting the body anyway would splice a live `${H.filename}` into
        // cli.js — a ReferenceError at reminder time that no apply-side gate
        // sees. Fail the patch instead.
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
    content.slice(0, match.index) +
    replacement +
    content.slice(match.index + match[0].length);
  showDiff(
    content,
    newContent,
    replacement,
    match.index,
    match.index + replacement.length
  );
  return newContent;
};

// Index of the `}` matching the `{` at `openIdx`, or -1. Brace-balanced and
// aware of the three JS string contexts plus `${…}` inside a template literal,
// so a `{` in `T(\`… ${gFn} …\`,{level:"error"})` cannot end the walk early.
export const matchingBrace = (content: string, openIdx: number): number => {
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

export const findCaseBody = (
  content: string,
  caseName: string,
  anchorEnglish: string
): { headerIdx: number; bodyStart: number; bodyEnd: number } | null => {
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

// Pull the array-wrapper / message-constructor minified identifiers from an
// existing case body. Pattern: `return …X([Y({content:` — Mac builds give o5/j6,
// Linux builds give o_/M8. The wrapper isn't always the first thing after
// `return`: the memory_update case prepends a comma-expression
// (`return K.push(rm6),HT([U6({content:`), so skip any non-`;` chars before the
// match. Prefer the last match (case bodies sometimes call the wrappers earlier
// with different ids for unrelated subcases).
export const discoverWrappers = (
  caseBody: string
): { arrayWrap: string; msgCtor: string } => {
  const re = /return\s+[^;]*?([$\w]+)\(\[([$\w]+)\(\{content:/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(caseBody)) !== null) last = m;
  return last
    ? { arrayWrap: last[1], msgCtor: last[2] }
    : { arrayWrap: 'o5', msgCtor: 'j6' };
};

// Capture the whole `if(<condition>)return[]` feature-gate CONDITION verbatim
// from the start of a case body, so the rewrite reuses the exact guard. Returning
// the full condition — not a single identifier with a hardcoded fallback — is
// load-bearing: the guard's shape AND its minified names churn across versions and
// platforms (2.1.204 was a single `if(!ZI())return[]`; 2.1.205 is a two-clause
// `if(!ZI()||YY())return[]`; linux renames both). The old single-identifier regex
// silently missed the two-clause shape and fell back to a hardcoded name (`GX`) —
// which a later build reused for an unrelated `class GX extends Error`, so the
// rewrite emitted `if(!GX())` → "Cannot call a class constructor GX without new"
// on every task-reminder render (a lazy path a parse-only apply check never hits).
// The condition is a `||`/`&&` chain of `!?FN()` calls; null = shape drifted →
// caller fails loud rather than guessing.
export const discoverFeatureGuard = (caseBody: string): string | null => {
  const m = caseBody.match(
    /^\s*if\((!?[$\w]+\(\)(?:(?:\|\||&&)!?[$\w]+\(\))*)\)return\s*\[\]/
  );
  return m ? m[1] : null;
};

// Pull the case-handler's delta-parameter name — the object each reminder reads
// its fields off, written as `${H.x}` in our override placeholders — from a
// pristine case body via a known field access. Mac and linux-x64 builds name it
// `H`, but linux-arm64 names it differently (e.g. `q`), so findCaseBody-based
// injections must discover it rather than hardcode `H` (which otherwise emits a
// runtime `H is not defined` on linux-arm64). Same platform-minified-name
// hazard the discoverWrappers / discoverFeatureGuard helpers above guard against.
export const discoverDeltaParam = (
  caseBody: string,
  sampleProp: string
): string => {
  const m = caseBody.match(new RegExp(`([$\\w]+)\\.${sampleProp}\\b`));
  return m ? m[1] : 'H';
};
