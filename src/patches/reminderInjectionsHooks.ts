import {
  ReminderInjection,
  findAndReplace,
  applySimpleEntry,
  propSlot,
} from './reminderShared';

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
  previousDefaultBodies: [
    "The date has changed. Today's date is now {{new_date}}. DO NOT mention this to the user explicitly because they are already aware.",
  ],
  name: 'Date change reminder',
  description:
    'Fires when the system date rolls over mid-session. Conditional. Empty .md body = silent date rollover.',
  placeholders: {
    new_date: '${H.newDate}',
  },
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
    'Surfaces hook command failures that block CC continuing. Conditional. Empty .md body = errors silenced (DANGEROUS \u2014 model will not see why hook blocked).',
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
