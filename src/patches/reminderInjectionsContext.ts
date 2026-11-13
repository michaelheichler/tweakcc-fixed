import {
  ReminderInjection,
  findCaseBody,
  isSuppressedCase,
} from './reminderShared';
import { showDiff } from './index';
import {
  applyBuilderCase,
  localFor,
  segmentFor,
  guardedValue,
  guardedData,
} from './reminderBuilder';
import { interpolations, matchingBrace } from './reminderSyntax';

export const CLAUDEMD_INJECTION: ReminderInjection = {
  id: 'claudemd-context',
  previousDefaultBodies: [
    "As you answer the user's questions, you can use the following context:\n{{context_blocks}}\n\n      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.",
  ],
  name: 'claudeMd context wrapper',
  description:
    "Per-turn <system-reminder> that bundles { claudeMd, userEmail, currentDate } into a 'As you answer the user's questions...' block. Empty .md body = suppress entirely.",
  placeholders: {
    context_blocks:
      '${Object.entries(_).map(([q,K])=>`# ${q}\\n${K}`).join(`\\n`)}',
  },
  defaultBody: `As you answer the user's questions, you can use the following context:
{{context_blocks}}

      Claude Code attached this context automatically; it isn't part of the user's message. It describes the user's own account and workspace, so they don't need it reported back.`,
  apply(content, body, isSuppressed) {
    const pattern =
      /function ([$\w]+)\(([$\w]+),([$\w]+)\)\{if\(Object\.entries\(\3\)\.length===0\)return \2;return\[(\{\.\.\.)?([$\w]+)\(\{content:[\s\S]{0,600}?,isMeta:!0\}\)(,[$\w]+:!0\})?,\.\.\.\2\]\}/;
    const match = content.match(pattern);
    if (!match || match.index === undefined) {
      if (/function [$\w]+\([$\w]+,[$\w]+\)\{return [$\w]+;\}/.test(content)) {
        return content;
      }
      console.error(
        'patch: reminder claudemd-context: failed to find kY6 wrapper'
      );
      return null;
    }
    const [fullMatch, fnName, msgsParam, ctxParam, spreadOpen, j6Name, flag] =
      match;
    if (!spreadOpen !== !flag) {
      console.error(
        'patch: reminder claudemd-context: unbalanced kY6 message wrapper'
      );
      return null;
    }
    let replacement: string;
    if (isSuppressed) {
      replacement = `function ${fnName}(${msgsParam},${ctxParam}){return ${msgsParam};}`;
    } else {
      const bodyForThisBuild = body.replace(
        /\bObject\.entries\(_\)/g,
        `Object.entries(${ctxParam})`
      );
      replacement =
        `function ${fnName}(${msgsParam},${ctxParam}){` +
        `if(Object.entries(${ctxParam}).length===0)return ${msgsParam};` +
        `return[${spreadOpen ?? ''}${j6Name}({content:\`<system-reminder>\n${bodyForThisBuild}\n</system-reminder>\n\`,isMeta:!0})${flag ?? ''},...${msgsParam}]}`;
    }
    const newContent =
      content.slice(0, match.index) +
      replacement +
      content.slice(match.index + fullMatch.length);
    showDiff(
      content,
      newContent,
      replacement,
      match.index,
      match.index + fullMatch.length
    );
    return newContent;
  },
};

export const MCP_INSTRUCTIONS_INJECTION: ReminderInjection = {
  id: 'mcp-instructions',
  previousDefaultBodies: [
    '# MCP Server Instructions\n\nThe following MCP servers have provided instructions for how to use their tools and resources:\n\n{{added_blocks}}',
  ],
  name: 'MCP server instructions block',
  description:
    'The "# MCP Server Instructions..." delta block. Empty .md body = suppress entirely. Per-server pruning lives in mcp-<name>.md files. ' +
    'A delta can add servers, remove them, or both: {{added_section}} is the whole pristine heading + instruction blocks and {{removed_section}} the pristine "have disconnected… no longer apply" list, each empty when that half of the delta is; ' +
    '{{added_blocks}} / {{removed_names}} are the bare guarded data for your own wording; {{ambient_note}} is the ambient-context suffix pristine adds with a removal. ' +
    'A line holding only such placeholders (plus your own text) disappears when they are all empty, with one adjacent blank line.',
  placeholders: {
    added_section: '${H.addedSection}',
    removed_section: '${H.removedSection}',
    added_blocks: '${H.addedBlocks.join(`\\n\\n`)}',
    removed_names: '${H.removedNames.join(`\\n`)}',
    ambient_note: '${H.ambientNote}',
  },
  defaultBody: '{{added_section}}\n\n{{removed_section}}\n\n{{ambient_note}}',
  apply(content, body, isSuppressed) {
    const found = findCaseBody(
      content,
      'mcp_instructions_delta',
      '# MCP Server Instructions'
    );
    if (!found) {
      if (isSuppressed && isSuppressedCase(content, 'mcp_instructions_delta'))
        return content;
      console.error(
        'patch: reminder mcp-instructions: failed to find case body'
      );
      return null;
    }
    return applyBuilderCase(
      content,
      'mcp-instructions',
      found,
      body,
      isSuppressed,
      'addedBlocks',
      (b, p) => {
        const addedLocal = localFor(b, p, 'addedBlocks');
        const removedLocal = localFor(b, p, 'removedNames');
        const added = segmentFor(b, addedLocal);
        const removed = segmentFor(b, removedLocal);
        return [
          {
            token: '${H.addedSection}',
            expr: added && guardedValue(added, 0),
            optional: true,
          },
          {
            token: '${H.removedSection}',
            expr: removed && guardedValue(removed, 0),
            optional: true,
          },
          {
            token: '${H.addedBlocks.join(`\\n\\n`)}',
            expr: guardedData(added, addedLocal),
            optional: true,
          },
          {
            token: '${H.removedNames.join(`\\n`)}',
            expr: guardedData(removed, removedLocal),
            optional: true,
          },
          {
            token: '${H.ambientNote}',
            expr:
              removed && removed.values.length > 1
                ? guardedValue(removed, 1)
                : null,
            optional: true,
          },
        ];
      }
    );
  },
};

export const AGENT_LISTING_INJECTION: ReminderInjection = {
  id: 'agent-listing',
  previousDefaultBodies: [
    'Available agent types for the Agent tool:\n{{listing}}',
  ],
  name: 'Agent listing reminder',
  description:
    'The agent-type listing delta: the full list at session start, then additions and removals. Empty .md body = suppress entirely. ' +
    '{{added_section}} is the pristine heading plus agent lines, {{removed_section}} the pristine "no longer available" list, each empty when that half of the delta is. ' +
    '{{heading}} is pristine\'s heading alone ("Available agent types for the Agent tool:" on the initial listing, "New agent types are now available for the Agent tool:" after), empty when nothing was added; ' +
    '{{listing}} / {{removed}} are the bare guarded lists. {{concurrency_note}} is the launch-in-parallel note (initial listing only, when CC asks for it); {{ambient_note}} is the suffix pristine adds with a removal. ' +
    'A line holding only such placeholders (plus your own text) disappears when they are all empty, with one adjacent blank line.',
  placeholders: {
    added_section: '${H.addedSection}',
    removed_section: '${H.removedSection}',
    heading: '${H.heading}',
    listing: '${H.addedLines.join(`\\n`)}',
    removed: '${H.removedTypes.map((K)=>`- ${K}`).join(`\\n`)}',
    concurrency_note: '${H.concurrencyNote}',
    ambient_note: '${H.ambientNote}',
  },
  defaultBody:
    '{{added_section}}\n\n{{removed_section}}\n\n{{ambient_note}}\n\n{{concurrency_note}}',
  apply(content, body, isSuppressed) {
    const found = findCaseBody(
      content,
      'agent_listing_delta',
      'Available agent types for the Agent tool:'
    );
    if (!found) {
      if (isSuppressed && isSuppressedCase(content, 'agent_listing_delta'))
        return content;
      console.error('patch: reminder agent-listing: failed to find case body');
      return null;
    }
    return applyBuilderCase(
      content,
      'agent-listing',
      found,
      body,
      isSuppressed,
      'addedLines',
      (b, p) => {
        const addedLocal = localFor(b, p, 'addedLines');
        const removedLocal = localFor(b, p, 'removedTypes');
        const added = segmentFor(b, addedLocal);
        const removed = segmentFor(b, removedLocal);
        const note = b.ifs.find(s =>
          s.cond.includes(`${p}.showConcurrencyNote`)
        );
        let heading: string | null = null;
        if (added) {
          const names = new Map(
            added.decls.map(d => {
              const eq = d.indexOf('=');
              return [d.slice(0, eq).trim(), d.slice(eq + 1)] as const;
            })
          );
          const v = added.values[0];
          const ref = v.startsWith('`')
            ? interpolations(v.slice(1, -1)).find(x => names.has(x))
            : undefined;
          if (ref !== undefined)
            heading = `(${added.cond})?(${names.get(ref)}):""`;
        }
        return [
          {
            token: '${H.addedSection}',
            expr: added && guardedValue(added, 0),
            optional: true,
          },
          {
            token: '${H.removedSection}',
            expr: removed && guardedValue(removed, 0),
            optional: true,
          },
          { token: '${H.heading}', expr: heading, optional: true },
          {
            token: '${H.addedLines.join(`\\n`)}',
            expr: guardedData(added, addedLocal),
            optional: true,
          },
          {
            token: '${H.removedTypes.map((K)=>`- ${K}`).join(`\\n`)}',
            expr: guardedData(removed, removedLocal),
            optional: true,
          },
          {
            token: '${H.concurrencyNote}',
            expr: note ? guardedValue(note, 0) : null,
            optional: true,
          },
          {
            token: '${H.ambientNote}',
            expr:
              removed && removed.values.length > 1
                ? guardedValue(removed, 1)
                : null,
            optional: true,
          },
        ];
      }
    );
  },
};

export const OUTPUT_STYLE_INJECTION: ReminderInjection = {
  id: 'output-style-banner',
  name: 'Output style banner',
  description:
    'Per-turn "X output style is active. Remember to follow..." reminder. Empty .md body = suppress entirely.',
  placeholders: {
    style_name: '${_.name}',
    turn_reminder:
      '${H.turnReminder??"Remember to follow the specific guidelines for this style."}',
  },
  defaultBody: `{{style_name}} output style is active. {{turn_reminder}}`,
  apply(content, body, isSuppressed) {
    const head = content.match(/output_style:\(([$\w]+)\)=>/);
    if (!head || head.index === undefined) {
      console.error(
        'patch: reminder output-style-banner: failed to find output_style arrow'
      );
      return null;
    }
    const hParam = head[1];
    const afterArrow = head.index + head[0].length;
    if (/^(\[\]|\{\s*return \[\];?\s*\})/.test(content.slice(afterArrow))) {
      return content;
    }
    if (content[afterArrow] !== '{') {
      console.error(
        'patch: reminder output-style-banner: output_style arrow is not a block body'
      );
      return null;
    }
    const bodyEnd = matchingBrace(content, afterArrow);
    if (bodyEnd === -1) {
      console.error(
        'patch: reminder output-style-banner: unbalanced output_style arrow body'
      );
      return null;
    }
    const arrowBody = content.slice(afterArrow + 1, bodyEnd);
    const ret = arrowBody.match(
      /return ([$\w]+)\(\[([$\w]+)\(\{content:`((?:[^`\\]|\\.)*)`,isMeta:!0\}\)\]\)$/
    );
    if (!ret || ret.index === undefined) {
      console.error(
        'patch: reminder output-style-banner: failed to find the reminder return expression'
      );
      return null;
    }
    const [, wrapFn, metaFn, template] = ret;
    const guards = arrowBody.slice(0, ret.index);
    let replacement: string;
    if (isSuppressed) {
      replacement = `output_style:(${hParam})=>[]`;
    } else {
      const nameExpr = template.match(
        /\$\{((?:[^{}]|\{[^{}]*\})*)\} output style is active\./
      );
      const reminderExpr = template.match(
        /\$\{((?:[^{}]|\{[^{}]*\})*turnReminder(?:[^{}]|\{[^{}]*\})*)\}/
      );
      if (!nameExpr || !reminderExpr) {
        console.error(
          'patch: reminder output-style-banner: no pristine expression for style_name/turn_reminder'
        );
        return null;
      }
      const built = body
        .split('${_.name}')
        .join(`\${${nameExpr[1]}}`)
        .replace(
          /\$\{H\.turnReminder(?:[^{}]|\{[^{}]*\})*\}/g,
          `\${${reminderExpr[1]}}`
        );
      replacement =
        `output_style:(${hParam})=>{${guards}` +
        `return ${wrapFn}([${metaFn}({content:\`${built}\`,isMeta:!0})])}`;
    }
    const newContent =
      content.slice(0, head.index) + replacement + content.slice(bodyEnd + 1);
    showDiff(
      content,
      newContent,
      replacement,
      head.index,
      head.index + replacement.length
    );
    return newContent;
  },
};
