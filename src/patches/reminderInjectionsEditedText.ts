import {
  matchingBrace,
  topLevelIndex,
  splitTopLevel,
  literalEnd,
  escapeRe,
  interpolations,
} from './reminderSyntax';
import { slotExpr, ReminderInjection, findAndReplace } from './reminderShared';
import { resolveSlots, emitReminder, ResolvedSlot } from './reminderRendering';
import { showDiff } from './index';

export const matchEditedTextStructure = (content: string) => {
  const match = content.match(
    /edited_text_file:\(([$\w]+)\)=>\{let ([$\w]+)=`/
  );
  if (!match || match.index === undefined) return null;
  const [, hParam, prefixVar] = match;
  const open = match.index + match[0].indexOf('{');
  const close = matchingBrace(content, open);
  if (close < 0) return null;
  const fnBody = content.slice(open + 1, close);
  const declEnd = topLevelIndex(fnBody, 4, ';');
  if (fnBody[declEnd] !== ';') return null;
  const declSrc = fnBody.slice(4, declEnd);
  const decls = splitTopLevel(declSrc, ',').map(d =>
    d.match(/^([$\w]+)=([\s\S]+)$/)
  );
  if (decls.some(d => d === null)) return null;
  const locals = decls.map(d => d![1]);
  const prefixTpl = decls[0]![2];
  if (literalEnd(prefixTpl, 0) !== prefixTpl.length - 1) return null;
  const rest = fnBody.slice(declEnd + 1);
  const head = rest.match(
    new RegExp(
      `^return ([$\\w]+)\\(\\[([$\\w]+)\\(\\{content:${escapeRe(hParam)}\\.snippet===""\\?`
    )
  );
  if (!head) return null;
  const [, o5Name, j6Name] = head;
  const emptyStart = head[0].length;
  const emptyEnd = rest[emptyStart] === '`' ? literalEnd(rest, emptyStart) : -1;
  if (emptyEnd < 0 || rest[emptyEnd + 1] !== ':' || rest[emptyEnd + 2] !== '`')
    return null;
  const fullEnd = literalEnd(rest, emptyEnd + 2);
  if (fullEnd < 0 || rest.slice(fullEnd + 1) !== ',isMeta:!0})])') return null;
  return {
    index: match.index,
    regionEnd: close + 1,
    hParam,
    prefixVar,
    declSrc,
    locals,
    prefixTpl,
    o5Name,
    j6Name,
    empty: rest.slice(emptyStart, emptyEnd + 1),
    full: rest.slice(emptyEnd + 2, fullEnd + 1),
  };
};

export const editedSnippetExpression = (
  full: string,
  prefixVar: string,
  locals: string[]
): string | null => {
  const tpl = full.slice(1, -1);
  for (let i = 0; i < tpl.length; i++) {
    if (tpl[i] === '\\') i++;
    else if (tpl[i] === '$' && tpl[i + 1] === '{') {
      const end = matchingBrace(tpl, i + 1);
      if (end < 0) break;
      const inner = tpl.slice(i + 2, end);
      if (inner !== prefixVar && locals.includes(inner))
        return '`' + tpl.slice(i) + '`';
      i = end;
    }
  }
  return null;
};

export const applyEditedTextFileStructural = (
  content: string,
  body: string,
  isSuppressed: boolean
): string | null | undefined => {
  const found = matchEditedTextStructure(content);
  if (!found) return undefined;
  const {
    index,
    regionEnd,
    hParam,
    prefixVar,
    declSrc,
    locals,
    prefixTpl,
    o5Name,
    j6Name,
    empty,
    full,
  } = found;
  let replacement: string;
  if (isSuppressed) {
    replacement = `edited_text_file:(${hParam})=>[]`;
  } else {
    const lead = new RegExp(`^\`\\$\\{${escapeRe(prefixVar)}\\}\\s*`);
    const changes =
      lead.test(empty) && lead.test(full)
        ? `${hParam}.snippet===""?${empty.replace(lead, '`')}:${full.replace(lead, '`')}`
        : null;
    const snippet =
      editedSnippetExpression(full, prefixVar, locals) ??
      slotExpr(content.slice(index, regionEnd), hParam, 'snippet');
    const resolved = resolveSlots('edited-text-file', body, [
      { token: '${H.filename}', expr: slotExpr(prefixTpl, hParam, 'filename') },
      { token: '${H.snippet}', expr: snippet, optional: true },
      { token: '${H.changes}', expr: changes },
      {
        token: '${H.readTool}',
        expr:
          interpolations(empty.slice(1, -1)).find(
            x =>
              /^[$\w]+$/.test(x) &&
              x !== prefixVar &&
              x !== hParam &&
              !locals.includes(x)
          ) ?? null,
      },
    ]);
    if (resolved === null) return null;
    replacement = `edited_text_file:(${hParam})=>{let ${declSrc};return ${emitReminder(o5Name, j6Name, body, resolved)}}`;
  }
  const newContent =
    content.slice(0, index) + replacement + content.slice(regionEnd);
  showDiff(content, newContent, replacement, index, regionEnd);
  return newContent;
};

export const EDITED_TEXT_FILE_INJECTION: ReminderInjection = {
  id: 'edited-text-file',
  previousDefaultBodies: [
    "Note: {{filename}} changed on disk since you last read it. That's usually deliberate, so take it as the current state rather than reverting it; if the change looks wrong, say so rather than undoing it yourself \u2014 otherwise no need to call it out. Here are the relevant changes (shown with line numbers):\n{{snippet}}",
    "Note: {{filename}} was modified, either by the user or by a linter. This change was intentional, so make sure to take it into account as you proceed (ie. don't revert it unless the user asks you to). Don't tell the user this, since they are already aware. Here are the relevant changes (shown with line numbers):\n{{snippet}}",
  ],
  name: 'Edited-text-file post-edit note',
  shadows: [
    'system-reminder-edited-file-changed-since-read',
    'system-reminder-edited-file-diff-omitted-snippet-budget',
    'system-reminder-file-modification-detected-budget-exceeded',
    'system-reminder-file-modified-externally',
  ],
  placeholders: {
    filename: '${H.filename}',
    snippet: '${H.snippet}',
    changes: '${H.changes}',
    read_tool: '${H.readTool}',
  },
  defaultBody:
    "Note: {{filename}} changed on disk since you last read it. That's usually deliberate, so take it as the current state rather than reverting it; if the change looks wrong, say so rather than undoing it yourself \u2014 otherwise no need to call it out. {{changes}}",
  description:
    'Conditional note injected after a file changes on disk (by the user or a linter). Empty .md body = silent edits. ' +
    'Pristine has two branches: with a diff snippet ("Here are the relevant changes (shown with line numbers):" + the snippet) and without one, when the snippet budget ran out ("The changes are not shown here; use <Read> if you need the current content."). ' +
    '{{changes}} is that pristine tail for whichever branch fires; {{snippet}} is the bare snippet (empty on the no-snippet branch, so a line holding only it disappears); {{read_tool}} is the Read tool name.',
  apply(content, body, isSuppressed) {
    const structural = applyEditedTextFileStructural(
      content,
      body,
      isSuppressed
    );
    if (structural !== undefined) return structural;
    const hoisted =
      /edited_text_file:\(([$\w]+)\)=>\{let ([$\w]+)=(`(?:[^`\\]|\\.)*`);return ([$\w]+)\(\[([$\w]+)\(\{content:\1\.snippet===""\?(`(?:[^`\\]|\\.)*`):(`(?:[^`\\]|\\.)*`),isMeta:!0\}\)\]\)\}/;
    const hoistedMatch = content.match(hoisted);
    if (hoistedMatch && hoistedMatch.index !== undefined) {
      const [
        region,
        hParam,
        prefixVar,
        prefixTpl,
        o5Name,
        j6Name,
        empty,
        full,
      ] = hoistedMatch;
      let replacement: string;
      if (isSuppressed) {
        replacement = `edited_text_file:(${hParam})=>[]`;
      } else {
        const lead = new RegExp(`^\`\\$\\{${escapeRe(prefixVar)}\\}\\s*`);
        const changes =
          lead.test(empty) && lead.test(full)
            ? `${hParam}.snippet===""?${empty.replace(lead, '`')}:${full.replace(lead, '`')}`
            : null;
        const resolved = resolveSlots('edited-text-file', body, [
          {
            token: '${H.filename}',
            expr: slotExpr(prefixTpl, hParam, 'filename'),
          },
          {
            token: '${H.snippet}',
            expr: slotExpr(region, hParam, 'snippet'),
            optional: true,
          },
          { token: '${H.changes}', expr: changes },
          {
            token: '${H.readTool}',
            expr:
              interpolations(empty.slice(1, -1)).find(
                x => /^[$\w]+$/.test(x) && x !== prefixVar && x !== hParam
              ) ?? null,
          },
        ]);
        if (resolved === null) return null;
        replacement = `edited_text_file:(${hParam})=>{let ${prefixVar}=${prefixTpl};return ${emitReminder(o5Name, j6Name, body, resolved)}}`;
      }
      const newContent =
        content.slice(0, hoistedMatch.index) +
        replacement +
        content.slice(hoistedMatch.index + region.length);
      showDiff(
        content,
        newContent,
        replacement,
        hoistedMatch.index,
        hoistedMatch.index + replacement.length
      );
      return newContent;
    }
    return findAndReplace(
      content,
      /edited_text_file:\(([$\w]+)\)=>([$\w]+)\(\[([$\w]+)\(\{content:\1\.snippet===""\?`Note: \$\{\1\.filename\} was modified, either by the user or by a linter\. This change was intentional, so make sure to take it into account as you proceed \(ie\. don't revert it unless the user asks you to\)\. Don't tell the user this, since they are already aware\. The diff was omitted because other modified files in this turn already exceeded the snippet budget; use the Read tool if you need the current content\.`:`Note: \$\{\1\.filename\} was modified, either by the user or by a linter\. This change was intentional, so make sure to take it into account as you proceed \(ie\. don't revert it unless the user asks you to\)\. Don't tell the user this, since they are already aware\. Here are the relevant changes \(shown with line numbers\):\n\$\{\1\.snippet\}`,isMeta:!0\}\)\]\)/,
      m => {
        const [, hParam, o5Name, j6Name] = m;
        if (isSuppressed) return `edited_text_file:(${hParam})=>[]`;
        const slots: ResolvedSlot[] = [
          {
            token: '${H.filename}',
            expr: `${hParam}.filename`,
            optional: false,
          },
          { token: '${H.snippet}', expr: `${hParam}.snippet`, optional: true },
          {
            token: '${H.changes}',
            expr: `${hParam}.snippet===""?\`The diff was omitted because other modified files in this turn already exceeded the snippet budget; use the Read tool if you need the current content.\`:\`Here are the relevant changes (shown with line numbers):\n\${${hParam}.snippet}\``,
            optional: false,
          },
          { token: '${H.readTool}', expr: '"Read"', optional: false },
        ];
        return `edited_text_file:(${hParam})=>${emitReminder(o5Name, j6Name, body, slots)}`;
      },
      'edited-text-file',
      c => /edited_text_file:\([$\w]+\)=>\[\]/.test(c)
    );
  },
};
