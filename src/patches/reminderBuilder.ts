import {
  matchingBrace,
  topLevelIndex,
  splitTopLevel,
  escapeRe,
  interpolations,
} from './reminderSyntax';
import { discoverDeltaParam } from './reminderShared';
import { resolveSlots, emitReminder } from './reminderRendering';
import { showDiff } from './index';

export type CaseStatement =
  | {
      kind: 'if';
      cond: string;
      body: string;
      isBlock: boolean;
    }
  | {
      kind: 'let';
      decls: string[];
    }
  | {
      kind: 'return';
      expr: string;
      start: number;
    }
  | {
      kind: 'expr';
      expr: string;
    };

export const parseStatements = (src: string): CaseStatement[] | null => {
  const out: CaseStatement[] = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /[\s;]/.test(src[i])) i++;
    if (i >= src.length) break;
    if (src.startsWith('if(', i)) {
      const condEnd = matchingBrace(src, i + 2);
      if (condEnd < 0) return null;
      const cond = src.slice(i + 3, condEnd);
      const j = condEnd + 1;
      if (src[j] === '{') {
        const blockEnd = matchingBrace(src, j);
        if (blockEnd < 0) return null;
        out.push({
          kind: 'if',
          cond,
          body: src.slice(j + 1, blockEnd),
          isBlock: true,
        });
        i = blockEnd + 1;
        continue;
      }
      const end = topLevelIndex(src, j, ';');
      out.push({ kind: 'if', cond, body: src.slice(j, end), isBlock: false });
      i = end + 1;
      continue;
    }
    const end = topLevelIndex(src, i, ';');
    const text = src.slice(i, end);
    const decl = text.match(/^(?:let|const|var)\s+/);
    if (decl)
      out.push({
        kind: 'let',
        decls: splitTopLevel(text.slice(decl[0].length), ','),
      });
    else if (/^return\b/.test(text))
      out.push({ kind: 'return', expr: text.slice(6).trim(), start: i });
    else out.push({ kind: 'expr', expr: text });
    i = end + 1;
  }
  return out;
};

export interface SegmentIf {
  cond: string;
  decls: string[];
  values: string[];
}

export interface PushBuilder {
  preamble: string;
  wrapFn: string;
  metaFn: string;
  arr: string;
  locals: Map<string, string>;
  ifs: SegmentIf[];
  tail: string[];
  tailExprs: string[];
}

export const matchEmit = (
  expr: string
): {
  wrapFn: string;
  metaFn: string;
  content: string | null;
} | null => {
  const plain = expr.match(
    /^([$\w]+)\(\[([$\w]+)\(\{content:([\s\S]*),isMeta:!0\}\)\]\)$/
  );
  if (plain) return { wrapFn: plain[1], metaFn: plain[2], content: plain[3] };
  const ours = expr.match(
    /^\(\(c\)=>c\.trim\(\)===""\?\[\]:([$\w]+)\(\[([$\w]+)\(\{content:c,isMeta:!0\}\)\]\)\)\(/
  );
  return ours ? { wrapFn: ours[1], metaFn: ours[2], content: null } : null;
};

export const builderTarget = (stmts: CaseStatement[]): string | null => {
  for (const s of stmts) {
    const exprs =
      s.kind === 'if'
        ? s.isBlock
          ? (parseStatements(s.body) ?? []).flatMap(t =>
              t.kind === 'expr' ? splitTopLevel(t.expr, ',') : []
            )
          : splitTopLevel(s.body, ',')
        : s.kind === 'expr'
          ? splitTopLevel(s.expr, ',')
          : [];
    for (const e of exprs) {
      const m = e.trim().match(/^([$\w]+)(?:\.push\(|\+=)/);
      if (m) return m[1];
    }
  }
  return null;
};

export const pushedValues = (exprs: string[], arr: string): string[] | null => {
  const values: string[] = [];
  const push = new RegExp(`^${escapeRe(arr)}\\.push\\(`);
  for (const raw of exprs) {
    const e = raw.trim();
    if (e === '') continue;
    if (push.test(e)) {
      const open = e.indexOf('(');
      if (matchingBrace(e, open) !== e.length - 1) return null;
      values.push(e.slice(open + 1, -1));
    } else if (e.startsWith(`${arr}+=`)) {
      values.push(e.slice(arr.length + 2));
    } else {
      return null;
    }
  }
  return values;
};

export const parsePushBuilder = (caseBody: string): PushBuilder | null => {
  const stmts = parseStatements(caseBody);
  if (!stmts) return null;
  const ret = stmts[stmts.length - 1];
  if (!ret || ret.kind !== 'return') return null;
  const parts = splitTopLevel(ret.expr, ',');
  const emit = matchEmit(parts[parts.length - 1]);
  if (!emit) return null;
  const arr =
    emit.content?.match(/^([$\w]+)(?:\.join\([\s\S]*\))?$/)?.[1] ??
    builderTarget(stmts);
  if (!arr) return null;
  const tail = pushedValues(parts.slice(0, -1), arr);
  if (!tail) return null;
  const locals = new Map<string, string>();
  const ifs: SegmentIf[] = [];
  for (const s of stmts.slice(0, -1)) {
    if (s.kind === 'let') {
      for (const d of s.decls) {
        const eq = d.indexOf('=');
        if (eq > 0) locals.set(d.slice(0, eq).trim(), d.slice(eq + 1));
      }
    } else if (s.kind === 'if') {
      let decls: string[] = [];
      let exprs: string[];
      if (s.isBlock) {
        const inner = parseStatements(s.body);
        if (!inner) continue;
        exprs = [];
        for (const t of inner) {
          if (t.kind === 'let') decls = decls.concat(t.decls);
          else if (t.kind === 'expr') exprs.push(...splitTopLevel(t.expr, ','));
          else exprs.push('\0');
        }
      } else {
        exprs = splitTopLevel(s.body, ',');
      }
      const values = pushedValues(exprs, arr);
      if (values && values.length > 0)
        ifs.push({ cond: s.cond, decls, values });
    } else if (s.kind === 'expr') {
      const values = pushedValues(splitTopLevel(s.expr, ','), arr);
      if (values && values.length > 0)
        ifs.push({ cond: '!0', decls: [], values });
    }
  }
  return {
    preamble: caseBody.slice(0, ret.start),
    wrapFn: emit.wrapFn,
    metaFn: emit.metaFn,
    arr,
    locals,
    ifs,
    tail,
    tailExprs: parts.slice(0, -1),
  };
};

export const localFor = (
  b: PushBuilder,
  param: string,
  prop: string
): string | null => {
  const re = new RegExp(`^(?:[$\\w]+\\()*${escapeRe(param)}\\.${prop}\\)*$`);
  for (const [name, init] of b.locals) if (re.test(init.trim())) return name;
  return null;
};

export const mentions = (src: string, ident: string): boolean =>
  new RegExp(`(^|[^$\\w.])${escapeRe(ident)}(?![$\\w])`).test(src);

export const segmentFor = (
  b: PushBuilder,
  local: string | null
): SegmentIf | null =>
  local === null
    ? null
    : (b.ifs.find(
        s => mentions(s.cond, local) && mentions(s.values[0], local)
      ) ?? null);

export const stripLeadingNewlines = (value: string): string =>
  value.startsWith('`')
    ? '`' + value.slice(1).replace(/^(?:\n|\\n)+/, '')
    : value;

export const guardedValue = (seg: SegmentIf, index: number): string => {
  const v = stripLeadingNewlines(seg.values[index]);
  const body =
    seg.decls.length > 0
      ? `(()=>{let ${seg.decls.join(',')};return ${v}})()`
      : v;
  return `(${seg.cond})?${body}:""`;
};

export const guardedData = (
  seg: SegmentIf | null,
  local: string | null
): string | null => {
  if (!seg || local === null) return null;
  const v = seg.values[0];
  const inner = v.startsWith('`')
    ? interpolations(v.slice(1, -1)).find(x => mentions(x, local))
    : undefined;
  return inner === undefined ? null : `(${seg.cond})?${inner}:""`;
};

export interface BuilderSlot {
  token: string;
  expr: string | null;
  optional?: boolean;
}

export const applyBuilderCase = (
  content: string,
  patchName: string,
  found: {
    bodyStart: number;
    bodyEnd: number;
  },
  body: string,
  isSuppressed: boolean,
  sampleProp: string,
  slotsFor: (b: PushBuilder, param: string, caseBody: string) => BuilderSlot[]
): string | null => {
  const { bodyStart, bodyEnd } = found;
  const caseBody = content.slice(bodyStart, bodyEnd);
  let newBody: string;
  if (isSuppressed) {
    newBody = 'return [];';
  } else {
    const b = parsePushBuilder(caseBody);
    if (b === null) {
      console.error(
        `patch: reminder ${patchName}: case body is not the push-builder shape`
      );
      return null;
    }
    const p = discoverDeltaParam(caseBody, sampleProp);
    const slots =
      p === null
        ? slotsFor(b, '\0', caseBody).map(s => ({ ...s, expr: null }))
        : slotsFor(b, p, caseBody);
    const resolved = resolveSlots(patchName, body, slots);
    if (resolved === null) return null;
    const ret = [
      ...b.tailExprs,
      emitReminder(b.wrapFn, b.metaFn, body, resolved),
    ].join(',');
    newBody = `${b.preamble}return ${ret}`;
  }
  const newContent =
    content.slice(0, bodyStart) + newBody + content.slice(bodyEnd);
  showDiff(content, newContent, newBody, bodyStart, bodyEnd);
  return newContent;
};
