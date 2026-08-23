import { showDiff } from './index';
import {
  ReminderInjection,
  findAndReplace,
  applySimpleEntry,
  propSlot,
  matchingBrace,
  findCaseBody,
  discoverWrappers,
  discoverDeltaParam,
} from './reminderShared';

export const CLAUDEMD_INJECTION: ReminderInjection = {
  id: 'claudemd-context',
  name: 'claudeMd context wrapper',
  description:
    "Per-turn <system-reminder> that bundles { claudeMd, userEmail, currentDate } into a 'As you answer the user's questions...' block. Empty .md body = suppress entirely.",
  placeholders: {
    context_blocks:
      '${Object.entries(_).map(([q,K])=>`# ${q}\\n${K}`).join(`\\n`)}',
  },
  defaultBody: `As you answer the user's questions, you can use the following context:
{{context_blocks}}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.`,
  apply(content, body, isSuppressed) {
    const pattern =
      /function ([$\w]+)\(([$\w]+),([$\w]+)\)\{if\(Object\.entries\(\3\)\.length===0\)return \2;return\[([$\w]+)\(\{content:`<system-reminder>\n[\s\S]*?\n<\/system-reminder>\n`,isMeta:!0\}\),\.\.\.\2\]\}/;
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
    const [fullMatch, fnName, msgsParam, ctxParam, j6Name] = match;

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
        `return[${j6Name}({content:\`<system-reminder>\n${bodyForThisBuild}\n</system-reminder>\n\`,isMeta:!0}),...${msgsParam}]}`;
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

export const SKILLS_INJECTION: ReminderInjection = {
  id: 'skills-listing',
  name: 'Skills listing reminder',
  description:
    'The "The following skills are available..." block. Empty .md body = suppress entirely.',
  placeholders: {
    skill_content: '${H.content}',
  },
  defaultBody: `The following skills are available for use with the Skill tool:

{{skill_content}}`,
  apply(content, body, isSuppressed) {
    const pattern =
      /skill_listing:\(([$\w]+)\)=>\{if\(!\1\.content\)return\[\];return ([$\w]+)\(\[([$\w]+)\(\{content:`The following skills are available for use with the Skill tool:\n\n\$\{\1\.content\}`,isMeta:!0\}\)\]\)\}/;
    const match = content.match(pattern);
    if (!match || match.index === undefined) {
      if (
        /skill_listing:\([$\w]+\)=>\{if\(!0\)return\[\]/.test(content) ||
        /skill_listing:\([$\w]+\)=>\{return \[\]/.test(content)
      ) {
        return content;
      }
      console.error(
        'patch: reminder skills-listing: failed to find skill_listing renderer'
      );
      return null;
    }
    const [fullMatch, argParam, o5Name, j6Name] = match;
    let replacement: string;
    if (isSuppressed) {
      replacement = `skill_listing:(${argParam})=>{return [];}`;
    } else {
      const bodyForBuild = body.replace(/\$\{H\./g, `\${${argParam}.`);
      replacement =
        `skill_listing:(${argParam})=>{` +
        `if(!${argParam}.content)return[];` +
        `return ${o5Name}([${j6Name}({content:\`${bodyForBuild}\`,isMeta:!0})])}`;
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
  name: 'MCP server instructions block',
  description:
    'The "# MCP Server Instructions..." block. Empty .md body = suppress entirely. Per-server pruning lives in mcp-<name>.md files.',
  placeholders: {
    added_blocks: '${H.addedBlocks.join(`\\n\\n`)}',
    removed_names: '${H.removedNames.join(`\\n`)}',
  },
  defaultBody: `# MCP Server Instructions

The following MCP servers have provided instructions for how to use their tools and resources:

{{added_blocks}}`,
  apply(content, body, isSuppressed) {
    const found = findCaseBody(
      content,
      'mcp_instructions_delta',
      '# MCP Server Instructions'
    );
    if (!found) {
      console.error(
        'patch: reminder mcp-instructions: failed to find case body'
      );
      return null;
    }
    const { bodyStart, bodyEnd } = found;
    const caseBody = content.slice(bodyStart, bodyEnd);
    const { arrayWrap, msgCtor } = discoverWrappers(caseBody);
    const p = discoverDeltaParam(caseBody, 'addedBlocks');
    const bodyForBuild = body.replace(/\$\{H\./g, `\${${p}.`);
    const newBody = isSuppressed
      ? 'return [];'
      : `if(${p}.addedBlocks.length===0&&${p}.removedNames.length===0)return [];return ${arrayWrap}([${msgCtor}({content:\`${bodyForBuild}\`,isMeta:!0})])`;
    const newContent =
      content.slice(0, bodyStart) + newBody + content.slice(bodyEnd);
    showDiff(content, newContent, newBody, bodyStart, bodyEnd);
    return newContent;
  },
};

export const AGENT_LISTING_INJECTION: ReminderInjection = {
  id: 'agent-listing',
  name: 'Agent listing reminder',
  description:
    'The "Available agent types for the Agent tool" block emitted at session start. Empty .md body = suppress entirely.',
  placeholders: {
    listing: '${H.addedLines.join(`\\n`)}',
    removed: '${H.removedTypes.map((K)=>`- ${K}`).join(`\\n`)}',
  },
  defaultBody: `Available agent types for the Agent tool:
{{listing}}`,
  apply(content, body, isSuppressed) {
    const found = findCaseBody(
      content,
      'agent_listing_delta',
      'Available agent types for the Agent tool:'
    );
    if (!found) {
      console.error('patch: reminder agent-listing: failed to find case body');
      return null;
    }
    const { bodyStart, bodyEnd } = found;
    const caseBody = content.slice(bodyStart, bodyEnd);
    const { arrayWrap, msgCtor } = discoverWrappers(caseBody);
    const p = discoverDeltaParam(caseBody, 'addedLines');
    const bodyForBuild = body.replace(/\$\{H\./g, `\${${p}.`);
    const newBody = isSuppressed
      ? 'return [];'
      : `if(${p}.addedLines.length===0&&${p}.removedTypes.length===0)return [];return ${arrayWrap}([${msgCtor}({content:\`${bodyForBuild}\`,isMeta:!0})])`;
    const newContent =
      content.slice(0, bodyStart) + newBody + content.slice(bodyEnd);
    showDiff(content, newContent, newBody, bodyStart, bodyEnd);
    return newContent;
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
  // Anchored on the registry key plus the arrow's code shape, never on the
  // guards that precede the return. CC 2.1.238 replaced the guard wholesale —
  // `let t=Oke[e.style];if(!t)return[];` became a type/emptiness check, a
  // 256-char cap and a control-char sanitizer (`pze(e.style)`) — which broke a
  // regex that spelled the old guard out, even though the site, the key, the
  // wrapper and the message builder were all unchanged. The guards are none of
  // this patch's business: it owns the CONTENT template only. So find the arrow
  // by key, keep whatever precedes the return verbatim, and recover both slot
  // expressions from the pristine template the same way `slotExpr` does — that
  // way the next guard rewrite (or a new wrapper around the style name) needs
  // no change here at all.
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
    // Already suppressed (by us, or by a build that emits nothing) — idempotent.
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
      // `${_.name}` is whatever expression pristine interpolates immediately
      // before " output style is active." — `${t.name}` up to 2.1.237,
      // `${pze(e.style)}` from 2.1.238.
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

export const THINKING_REMINDER_INJECTION: ReminderInjection = {
  id: 'thinking-reminder',
  name: 'Thinking reminder (anti-thinking nudge / F97)',
  description:
    "Per-turn 'Respond with just the action or changes and without a thinking block...' nudge that fires when CC decides you shouldn't be thinking. Conditional (only most turns). Empty .md body = suppress entirely.",
  placeholders: {},
  defaultBody:
    'Respond with just the action or changes and without a thinking block, unless this is a redesign or requires fresh reasoning.',
  apply(content, body, isSuppressed) {
    if (!/thinking_reminder:\(/.test(content)) {
      return content;
    }
    return findAndReplace(
      content,
      /thinking_reminder:\(\)=>\[([$\w]+)\(\{content:([$\w]+)\(([$\w]+)\),isMeta:!0\}\)\]/,
      m => {
        const [, j6Name, lwName] = m;
        if (isSuppressed) return 'thinking_reminder:()=>[]';
        return `thinking_reminder:()=>[${j6Name}({content:${lwName}(\`${body}\`),isMeta:!0})]`;
      },
      'thinking-reminder',
      c => /thinking_reminder:\(\)=>\[\]/.test(c)
    );
  },
};

export const ULTRATHINK_INJECTION: ReminderInjection = {
  id: 'ultrathink-effort',
  name: 'Ultrathink keyword booster',
  description:
    'Fires when user input matches /\\bultrathink\\b/i. Empty .md body = the keyword triggers nothing.',
  placeholders: {},
  defaultBody:
    'The user included the keyword "ultrathink", requesting deeper reasoning on this turn. Reason as thoroughly as the task warrants.',
  apply(content, body, isSuppressed) {
    return findAndReplace(
      content,
      /ultrathink_effort:\(\)=>([$\w]+)\(\[([$\w]+)\(\{content:'[^']*',isMeta:!0\}\)\]\)/,
      m => {
        const [, o5Name, j6Name] = m;
        if (isSuppressed) return 'ultrathink_effort:()=>[]';
        return `ultrathink_effort:()=>${o5Name}([${j6Name}({content:\`${body}\`,isMeta:!0})])`;
      },
      'ultrathink-effort',
      c => /ultrathink_effort:\(\)=>\[\]/.test(c)
    );
  },
};

export const DATE_CHANGE_INJECTION: ReminderInjection = {
  id: 'date-change',
  name: 'Date change reminder',
  description:
    'Fires when the system date rolls over mid-session. Conditional. Empty .md body = silent date rollover.',
  placeholders: {
    new_date: '${H.newDate}',
  },
  // CC 2.1.234 reworded this ("DO NOT mention this to the user explicitly
  // because they are already aware." -> the clock line below).
  defaultBody:
    "The date has changed. Today's date is now {{new_date}}. No need to announce the new date \u2014 the user's own clock shows it.",
  apply(content, body, isSuppressed) {
    return applySimpleEntry(
      content,
      'date_change',
      [propSlot('${H.newDate}', 'newDate')],
      body,
      isSuppressed
    );
  },
};

export const HOOK_ADDITIONAL_CONTEXT_INJECTION: ReminderInjection = {
  id: 'hook-additional-context',
  name: 'Hook additional-context wrapper',
  description:
    'Wraps content returned by user-defined hooks into the model context. Conditional. Empty .md body = hook content suppressed.',
  placeholders: {
    hook_name: '${H.hookName}',
    hook_content: '${H.content.join(`\n`)}',
  },
  defaultBody: '{{hook_name}} hook additional context: {{hook_content}}',
  apply(content, body, isSuppressed) {
    // cli.js has a real newline between the backticks (not the `\n` escape).
    return findAndReplace(
      content,
      /hook_additional_context:\(([$\w]+)\)=>\{if\(\1\.content\.length===0\)return\[\];return\[([$\w]+)\(\{content:([$\w]+)\(`\$\{\1\.hookName\} hook additional context: \$\{\1\.content\.join\(`\n`\)\}`\),isMeta:!0\}\)\]\}/,
      m => {
        const [, hParam, j6Name, lwName] = m;
        if (isSuppressed) return `hook_additional_context:(${hParam})=>[]`;
        const bodyForBuild = body
          .replace(/\$\{H\.hookName\}/g, `\${${hParam}.hookName}`)
          .replace(
            /\$\{H\.content\.join\(`\n`\)\}/g,
            `\${${hParam}.content.join(\`\n\`)}`
          );
        return `hook_additional_context:(${hParam})=>{if(${hParam}.content.length===0)return[];return[${j6Name}({content:${lwName}(\`${bodyForBuild}\`),isMeta:!0})]}`;
      },
      'hook-additional-context',
      c => /hook_additional_context:\([$\w]+\)=>\[\]/.test(c)
    );
  },
};

export const HOOK_BLOCKING_ERROR_INJECTION: ReminderInjection = {
  id: 'hook-blocking-error',
  name: 'Hook blocking-error wrapper',
  description:
    'Surfaces hook command failures that block CC continuing. Conditional. Empty .md body = errors silenced (DANGEROUS — model will not see why hook blocked).',
  placeholders: {
    hook_name: '${H.hookName}',
    command: '${H.blockingError.command}',
    error: '${H.blockingError.blockingError}',
  },
  defaultBody:
    '{{hook_name}} hook blocking error from command: "{{command}}": {{error}}',
  apply(content, body, isSuppressed) {
    return findAndReplace(
      content,
      /hook_blocking_error:\(([$\w]+)\)=>\[([$\w]+)\(\{content:([$\w]+)\(`\$\{\1\.hookName\} hook blocking error from command: "\$\{\1\.blockingError\.command\}": \$\{\1\.blockingError\.blockingError\}`\),isMeta:!0\}\)\]/,
      m => {
        const [, hParam, j6Name, lwName] = m;
        if (isSuppressed) return `hook_blocking_error:(${hParam})=>[]`;
        const bodyForBuild = body
          .replace(/\$\{H\.hookName\}/g, `\${${hParam}.hookName}`)
          .replace(
            /\$\{H\.blockingError\.command\}/g,
            `\${${hParam}.blockingError.command}`
          )
          .replace(
            /\$\{H\.blockingError\.blockingError\}/g,
            `\${${hParam}.blockingError.blockingError}`
          );
        return `hook_blocking_error:(${hParam})=>[${j6Name}({content:${lwName}(\`${bodyForBuild}\`),isMeta:!0})]`;
      },
      'hook-blocking-error',
      c => /hook_blocking_error:\([$\w]+\)=>\[\]/.test(c)
    );
  },
};

export const HOOK_STOPPED_INJECTION: ReminderInjection = {
  id: 'hook-stopped-continuation',
  name: 'Hook stopped-continuation wrapper',
  description:
    'Fires when a hook returned a stop signal. Conditional. Empty .md body = stop reason hidden from model.',
  placeholders: {
    hook_name: '${H.hookName}',
    message: '${H.message}',
  },
  defaultBody: '{{hook_name}} hook stopped continuation: {{message}}',
  apply(content, body, isSuppressed) {
    return findAndReplace(
      content,
      /hook_stopped_continuation:\(([$\w]+)\)=>\[([$\w]+)\(\{content:([$\w]+)\(`\$\{\1\.hookName\} hook stopped continuation: \$\{\1\.message\}`\),isMeta:!0\}\)\]/,
      m => {
        const [, hParam, j6Name, lwName] = m;
        if (isSuppressed) return `hook_stopped_continuation:(${hParam})=>[]`;
        const bodyForBuild = body
          .replace(/\$\{H\.hookName\}/g, `\${${hParam}.hookName}`)
          .replace(/\$\{H\.message\}/g, `\${${hParam}.message}`);
        return `hook_stopped_continuation:(${hParam})=>[${j6Name}({content:${lwName}(\`${bodyForBuild}\`),isMeta:!0})]`;
      },
      'hook-stopped-continuation',
      c => /hook_stopped_continuation:\([$\w]+\)=>\[\]/.test(c)
    );
  },
};
