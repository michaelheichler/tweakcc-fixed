import { showDiff } from './index';
import {
  ReminderInjection,
  findAndReplace,
  applySimpleEntry,
  propSlot,
  toolNameSlot,
  slotExpr,
} from './reminderShared';

const TOOL_CALLED_INJECTION: ReminderInjection = {
  id: 'tool-called',
  name: 'Tool-called preamble',
  description:
    'Per-tool-call preamble: "Called the X tool with the following input: ...". Empty .md body = no preamble (LW strips empty content).',
  placeholders: {
    tool_name: '${H}',
    tool_input: '${SH(_)}',
  },
  defaultBody:
    'Called the {{tool_name}} tool with the following input: {{tool_input}}',
  apply(content, body, isSuppressed) {
    return findAndReplace(
      content,
      /function ([$\w]+)\(([$\w]+),([$\w]+)\)\{return ([$\w]+)\(\{content:`Called the \$\{\2\} tool with the following input: \$\{([$\w]+)\(\3\)\}`,isMeta:!0\}\)\}/,
      m => {
        const [, fnName, p1, p2, j6Name, shName] = m;
        if (isSuppressed) {
          return `function ${fnName}(${p1},${p2}){return ${j6Name}({content:"",isMeta:!0})}`;
        }
        const bodyForBuild = body
          .replace(/\$\{H\}/g, `\${${p1}}`)
          .replace(/\$\{SH\(_\)\}/g, `\${${shName}(${p2})}`);
        return `function ${fnName}(${p1},${p2}){return ${j6Name}({content:\`${bodyForBuild}\`,isMeta:!0})}`;
      },
      'tool-called'
    );
  },
};

const TOOL_RESULT_INJECTION: ReminderInjection = {
  id: 'tool-result',
  name: 'Tool-result wrapper',
  description:
    'Per-tool-call result wrapper: "Result of calling the X tool: <output>". Empty .md body = strip the wrapper line (just emit the result).',
  placeholders: {
    tool_name: '${H.name}',
    result: '${K}',
  },
  defaultBody: 'Result of calling the {{tool_name}} tool:\n{{result}}',
  apply(content, body, isSuppressed) {
    return findAndReplace(
      content,
      /return ([$\w]+)\(\{content:`Result of calling the \$\{([$\w]+)\.name\} tool:\n\$\{([$\w]+)\}`,isMeta:!0\}\)\}catch\{return [$\w]+\(\{content:`Result of calling the \$\{\2\.name\} tool: Error`,isMeta:!0\}\)\}/,
      m => {
        const [, j6Name, hParam, kVar] = m;
        if (isSuppressed) {
          return `return ${j6Name}({content:\`\${${kVar}}\`,isMeta:!0})}catch{return ${j6Name}({content:"",isMeta:!0})}`;
        }
        const bodyForBuild = body
          .replace(/\$\{H\.name\}/g, `\${${hParam}.name}`)
          .replace(/\$\{K\}/g, `\${${kVar}}`);
        return `return ${j6Name}({content:\`${bodyForBuild}\`,isMeta:!0})}catch{return ${j6Name}({content:\`Result of calling the \${${hParam}.name} tool: Error\`,isMeta:!0})}`;
      },
      'tool-result'
    );
  },
};

const TOOL_ERROR_INJECTION: ReminderInjection = {
  id: 'tool-error',
  name: 'Tool-error wrapper',
  description:
    'Fires from the catch branch of the tool-result wrapper when result formatting throws. Empty .md body = silent error.',
  placeholders: {
    tool_name: '${H.name}',
  },
  defaultBody: 'Result of calling the {{tool_name}} tool: Error',
  apply(content, body, isSuppressed) {
    return findAndReplace(
      content,
      /catch\{return ([$\w]+)\(\{content:`Result of calling the \$\{([$\w]+)\.name\} tool: Error`,isMeta:!0\}\)\}/,
      m => {
        const [, j6Name, hParam] = m;
        if (isSuppressed)
          return `catch{return ${j6Name}({content:"",isMeta:!0})}`;
        const bodyForBuild = body.replace(
          /\$\{H\.name\}/g,
          `\${${hParam}.name}`
        );
        return `catch{return ${j6Name}({content:\`${bodyForBuild}\`,isMeta:!0})}`;
      },
      'tool-error'
    );
  },
};

const LOCAL_CMD_CAVEAT_INJECTION: ReminderInjection = {
  id: 'local-command-caveat',
  name: 'Local-command caveat wrapper',
  description:
    'Wraps output of !shell-command with anti-confusion framing. Empty .md body = no caveat (security-relevant; suppressing means the model may misinterpret command output as user input).',
  placeholders: {
    tag_name: '${Gq_}',
  },
  defaultBody:
    "The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user. It's recorded here as context for later messages.",
  apply(content, body, isSuppressed) {
    const key = content.match(/[,;{ ]([$\w]+)="local-command-caveat"(?=[,;])/);
    if (!key) {
      console.error(
        'patch: reminder local-command-caveat: failed to find tag variable'
      );
      return null;
    }
    const tag = key[1].replace(/\$/g, '\\$');
    return findAndReplace(
      content,
      new RegExp(
        '([$\\w]+)\\(\\{content:`<\\$\\{(' +
          tag +
          ')\\}>[^`]*?<\\/\\$\\{\\2\\}>`,isMeta:!0\\}\\)'
      ),
      m => {
        const [, j6Name, tagVar] = m;
        if (isSuppressed) return `${j6Name}({content:"",isMeta:!0})`;
        const innerBody = body.replace(/\$\{Gq_\}/g, `\${${tagVar}}`);
        return `${j6Name}({content:\`<\${${tagVar}}>${innerBody}</\${${tagVar}}>\`,isMeta:!0})`;
      },
      'local-command-caveat'
    );
  },
};

const COMPACT_FILE_REF_INJECTION: ReminderInjection = {
  id: 'compact-file-reference',
  name: 'Compact-time file reference note',
  description:
    'Note injected after compaction when a referenced file is too large to inline. Conditional. Empty .md body = silent omission.',
  placeholders: {
    filename: '${H.filename}',
    read_tool_name: '${oO.name}',
  },
  defaultBody:
    'Note: {{filename}} was read before the last conversation was summarized, but the contents are too large to include. Use {{read_tool_name}} tool if you need to access it.',
  apply(content, body, isSuppressed) {
    return applySimpleEntry(
      content,
      'compact_file_reference',
      [propSlot('${H.filename}', 'filename'), toolNameSlot('${oO.name}')],
      body,
      isSuppressed
    );
  },
};

const PDF_REF_INJECTION: ReminderInjection = {
  id: 'pdf-reference',
  name: 'PDF too-large note',
  description:
    'Conditional note when a referenced PDF is too large for direct read. Empty .md body = silent omission.',
  placeholders: {
    filename: '${H.filename}',
    page_count: '${H.pageCount}',
    file_size: '${l7(H.fileSize)}',
    read_tool: '${uq}',
  },
  defaultBody:
    'PDF file: {{filename}} ({{page_count}} pages, {{file_size}}). This PDF is too large to read all at once. You MUST use the {{read_tool}} tool with the pages parameter to read specific page ranges (e.g., pages: "1-5"). Do NOT call {{read_tool}} without the pages parameter or it will fail. Start by reading the first few pages to understand the structure, then read more as needed. Maximum 20 pages per request.',
  apply(content, body, isSuppressed) {
    return applySimpleEntry(
      content,
      'pdf_reference',
      [
        propSlot('${H.filename}', 'filename'),
        propSlot('${H.pageCount}', 'pageCount'),
        propSlot('${l7(H.fileSize)}', 'fileSize'),
        toolNameSlot('${uq}'),
      ],
      body,
      isSuppressed
    );
  },
};

const EDITED_TEXT_FILE_INJECTION: ReminderInjection = {
  id: 'edited-text-file',
  name: 'Edited-text-file post-edit note',
  description:
    'Conditional note injected after a file is edited (by user or linter). Empty .md body = silent edits.',
  shadows: [
    'system-reminder-edited-file-changed-since-read',
    'system-reminder-edited-file-diff-omitted-snippet-budget',
    'system-reminder-file-modification-detected-budget-exceeded',
    'system-reminder-file-modified-externally',
  ],
  placeholders: {
    filename: '${H.filename}',
    snippet: '${H.snippet}',
  },
  defaultBody:
    "Note: {{filename}} changed on disk since you last read it. That's usually deliberate, so take it as the current state rather than reverting it; if the change looks wrong, say so rather than undoing it yourself \u2014 otherwise no need to call it out. Here are the relevant changes (shown with line numbers):\n{{snippet}}",
  apply(content, body, isSuppressed) {
    const hoisted =
      /edited_text_file:\(([$\w]+)\)=>\{let ([$\w]+)=`((?:[^`\\]|\\.)*)`;return ([$\w]+)\(\[([$\w]+)\(\{content:\1\.snippet===""\?`(?:[^`\\]|\\.)*`:`(?:[^`\\]|\\.)*`,isMeta:!0\}\)\]\)\}/;
    const hoistedMatch = content.match(hoisted);
    if (hoistedMatch && hoistedMatch.index !== undefined) {
      const [, hParam, , prefixTpl, o5Name, j6Name] = hoistedMatch;
      let replacement: string;
      if (isSuppressed) {
        replacement = `edited_text_file:(${hParam})=>[]`;
      } else {
        const region = hoistedMatch[0];
        const fileExpr = slotExpr(prefixTpl, hParam, 'filename');
        const snippetExpr = slotExpr(region, hParam, 'snippet');
        if (
          (body.includes('${H.filename}') && fileExpr === null) ||
          (body.includes('${H.snippet}') && snippetExpr === null)
        ) {
          console.error(
            'patch: reminder edited-text-file: no pristine expression for a placeholder'
          );
          return null;
        }
        const bodyForBuild = body
          .split('${H.filename}')
          .join(`\${${fileExpr}}`)
          .split('${H.snippet}')
          .join(`\${${snippetExpr}}`);
        replacement = `edited_text_file:(${hParam})=>${o5Name}([${j6Name}({content:\`${bodyForBuild}\`,isMeta:!0})])`;
      }
      const newContent =
        content.slice(0, hoistedMatch.index) +
        replacement +
        content.slice(hoistedMatch.index + hoistedMatch[0].length);
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
        const bodyForBuild = body
          .replace(/\$\{H\.filename\}/g, `\${${hParam}.filename}`)
          .replace(/\$\{H\.snippet\}/g, `\${${hParam}.snippet}`);
        return `edited_text_file:(${hParam})=>${o5Name}([${j6Name}({content:\`${bodyForBuild}\`,isMeta:!0})])`;
      },
      'edited-text-file',
      c => /edited_text_file:\([$\w]+\)=>\[\]/.test(c)
    );
  },
};

export {
  TOOL_CALLED_INJECTION,
  TOOL_RESULT_INJECTION,
  TOOL_ERROR_INJECTION,
  LOCAL_CMD_CAVEAT_INJECTION,
  COMPACT_FILE_REF_INJECTION,
  PDF_REF_INJECTION,
  EDITED_TEXT_FILE_INJECTION,
};
