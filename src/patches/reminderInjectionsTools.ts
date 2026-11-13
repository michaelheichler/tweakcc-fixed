import {
  ReminderInjection,
  findAndReplace,
  applySimpleEntry,
  propSlot,
  toolNameSlot,
  pageCountTextSlot,
  modelRefusedSlot,
  unreadableReasonSlot,
} from './reminderShared';
import { showDiff } from './index';

export const TOOL_CALLED_INJECTION: ReminderInjection = {
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
    const shape =
      /function ([$\w]+)\(([$\w]+),([$\w]+)\)\{return ([$\w]+)\(\{content:`[^`$\\]*\$\{\2\}[^`$\\]*\$\{((?:[$\w]+\()+\3\)+)\}`,isMeta:!0\}\)\}/g;
    const hits = [...content.matchAll(shape)];
    if (hits.length === 1 && hits[0].index !== undefined) {
      const m = hits[0];
      const [region, fnName, p1, p2, j6Name, inputExpr] = m;
      const open = (inputExpr.match(/\(/g) ?? []).length;
      const close = (inputExpr.match(/\)/g) ?? []).length;
      if (open === close) {
        const replacement = isSuppressed
          ? `function ${fnName}(${p1},${p2}){return ${j6Name}({content:"",isMeta:!0})}`
          : `function ${fnName}(${p1},${p2}){return ${j6Name}({content:\`${body
              .replace(/\$\{H\}/g, () => `\${${p1}}`)
              .replace(
                /\$\{SH\(_\)\}/g,
                () => `\${${inputExpr}}`
              )}\`,isMeta:!0})}`;
        const newContent =
          content.slice(0, m.index) +
          replacement +
          content.slice(m.index! + region.length);
        showDiff(
          content,
          newContent,
          replacement,
          m.index!,
          m.index! + region.length
        );
        return newContent;
      }
    }
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
      'tool-called',
      c =>
        isSuppressed &&
        /function [$\w]+\([$\w]+,[$\w]+\)\{return [$\w]+\(\{content:"",isMeta:!0\}\)\}/.test(
          c
        )
    );
  },
};

export const TOOL_RESULT_INJECTION: ReminderInjection = {
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

export const TOOL_ERROR_INJECTION: ReminderInjection = {
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

export const LOCAL_CMD_CAVEAT_INJECTION: ReminderInjection = {
  id: 'local-command-caveat',
  previousDefaultBodies: [
    'Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.',
  ],
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

export const COMPACT_FILE_REF_INJECTION: ReminderInjection = {
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

export const PDF_REF_INJECTION: ReminderInjection = {
  id: 'pdf-reference',
  previousDefaultBodies: [
    'PDF file: {{filename}} ({{page_count}} pages, {{file_size}}). This PDF is too large to read all at once. You MUST use the {{read_tool}} tool with the pages parameter to read specific page ranges (e.g., pages: "1-5"). Do NOT call {{read_tool}} without the pages parameter or it will fail. Start by reading the first few pages to understand the structure, then read more as needed. Maximum 20 pages per request.',
  ],
  name: 'PDF too-large note',
  description:
    'Conditional note when a referenced PDF is too large for direct read, or the model cannot take it whole. Empty .md body = silent omission. ' +
    'Use {{page_count_text}} ("N pages" / "page count unknown"), not "{{page_count}} pages", which prints "null pages" when the count is unknown. ' +
    '{{unreadable_reason}} is pristine\'s refusal sentence for a model that cannot be sent the PDF, else "This PDF is too large to read all at once."; ' +
    '{{model_refused_note}} is only the refusal sentence (empty otherwise, so a line holding only it disappears). The readable-whole branch stays pristine.',
  placeholders: {
    filename: '${H.filename}',
    page_count: '${H.pageCount}',
    page_count_text: '${H.pageCountText}',
    file_size: '${l7(H.fileSize)}',
    read_tool: '${uq}',
    model_refused_note: '${H.modelRefusedNote}',
    unreadable_reason: '${H.unreadableReason}',
  },
  defaultBody:
    'PDF file: {{filename}} ({{page_count_text}}, {{file_size}}). {{unreadable_reason}} You MUST use the {{read_tool}} tool with the pages parameter to read specific page ranges (e.g., pages: "1-5"). Do NOT call {{read_tool}} without the pages parameter or it will fail. Start by reading the first few pages to understand the structure, then read more as needed. Maximum 20 pages per request.',
  apply(content, body, isSuppressed) {
    return applySimpleEntry(
      content,
      'pdf_reference',
      [
        propSlot('${H.filename}', 'filename'),
        propSlot('${H.pageCount}', 'pageCount'),
        pageCountTextSlot('${H.pageCountText}'),
        propSlot('${l7(H.fileSize)}', 'fileSize'),
        toolNameSlot('${uq}'),
        modelRefusedSlot('${H.modelRefusedNote}'),
        unreadableReasonSlot('${H.unreadableReason}'),
      ],
      body,
      isSuppressed
    );
  },
};
