import { showDiff } from './index';
import {
  ReminderInjection,
  simpleEntryPattern,
  applySimpleEntry,
  propSlot,
  findAndReplace,
  findCaseBody,
  discoverWrappers,
  discoverDeltaParam,
} from './reminderShared';

const SELECTED_LINES_INJECTION: ReminderInjection = {
  id: 'selected-lines-in-ide',
  name: 'IDE selected-lines reminder',
  description:
    'Fires when an IDE selection is sent into chat. Conditional. Empty .md body = silent selection (model not told what user selected).',
  placeholders: {
    line_start: '${H.lineStart}',
    line_end: '${H.lineEnd}',
    filename: '${H.filename}',
    selected_text: '${q}',
  },
  defaultBody:
    'The user selected the lines {{line_start}} to {{line_end}} from {{filename}}:\n{{selected_text}}\n\nThis may or may not be related to the current task.',
  apply(content, body, isSuppressed) {
    if (simpleEntryPattern('selected_lines_in_ide').test(content)) {
      return applySimpleEntry(
        content,
        'selected_lines_in_ide',
        [
          propSlot('${H.lineStart}', 'lineStart'),
          propSlot('${H.lineEnd}', 'lineEnd'),
          propSlot('${H.filename}', 'filename'),
          propSlot('${q}', 'content'),
        ],
        body,
        isSuppressed
      );
    }
    return findAndReplace(
      content,
      /selected_lines_in_ide:\(([$\w]+)\)=>\{let ([$\w]+)=\1\.content\.length>2000\?\1\.content\.substring\(0,2000\)\+`\n\.\.\. \(truncated\)`:\1\.content;return ([$\w]+)\(\[([$\w]+)\(\{content:`The user selected the lines \$\{\1\.lineStart\} to \$\{\1\.lineEnd\} from \$\{\1\.filename\}:\n\$\{\2\}\n\nThis may or may not be related to the current task\.`,isMeta:!0\}\)\]\)\}/,
      m => {
        const [, hParam, qVar, o5Name, j6Name] = m;
        if (isSuppressed) return `selected_lines_in_ide:(${hParam})=>[]`;
        const bodyForBuild = body
          .replace(/\$\{H\.lineStart\}/g, `\${${hParam}.lineStart}`)
          .replace(/\$\{H\.lineEnd\}/g, `\${${hParam}.lineEnd}`)
          .replace(/\$\{H\.filename\}/g, `\${${hParam}.filename}`)
          .replace(/\$\{q\}/g, `\${${qVar}}`);
        return `selected_lines_in_ide:(${hParam})=>{let ${qVar}=${hParam}.content.length>2000?${hParam}.content.substring(0,2000)+\`\n... (truncated)\`:${hParam}.content;return ${o5Name}([${j6Name}({content:\`${bodyForBuild}\`,isMeta:!0})])}`;
      },
      'selected-lines-in-ide',
      c => /selected_lines_in_ide:\([$\w]+\)=>\[\]/.test(c)
    );
  },
};

const OPENED_FILE_INJECTION: ReminderInjection = {
  id: 'opened-file-in-ide',
  name: 'IDE opened-file reminder',
  description:
    'Fires when user focuses a new file in the IDE during a CC session. Conditional. Empty .md body = silent.',
  placeholders: {
    filename: '${H.filename}',
  },
  defaultBody:
    'The user opened the file {{filename}} in the IDE. This may or may not be related to the current task.',
  apply(content, body, isSuppressed) {
    return applySimpleEntry(
      content,
      'opened_file_in_ide',
      [propSlot('${H.filename}', 'filename')],
      body,
      isSuppressed
    );
  },
};

const PLAN_FILE_REF_INJECTION: ReminderInjection = {
  id: 'plan-file-reference',
  name: 'Plan-file reference',
  description:
    'Surfaces an existing plan file from plan mode. Conditional. Empty .md body = plan file invisible to model.',
  placeholders: {
    plan_file_path: '${H.planFilePath}',
    plan_content: '${H.planContent}',
  },
  defaultBody:
    'A plan file exists from plan mode at: {{plan_file_path}}\n\nPlan contents:\n\n{{plan_content}}\n\nIf this plan is relevant to the current work and not already complete, continue working on it.',
  apply(content, body, isSuppressed) {
    return findAndReplace(
      content,
      /plan_file_reference:\(([$\w]+)\)=>([$\w]+)\(\[([$\w]+)\(\{content:`A plan file exists from plan mode at: \$\{\1\.planFilePath\}\n\nPlan contents:\n\n\$\{\1\.planContent\}\n\nIf this plan is relevant to the current work and not already complete, continue working on it\.`,isMeta:!0\}\)\]\)/,
      m => {
        const [, hParam, o5Name, j6Name] = m;
        if (isSuppressed) return `plan_file_reference:(${hParam})=>[]`;
        const bodyForBuild = body
          .replace(/\$\{H\.planFilePath\}/g, `\${${hParam}.planFilePath}`)
          .replace(/\$\{H\.planContent\}/g, `\${${hParam}.planContent}`);
        return `plan_file_reference:(${hParam})=>${o5Name}([${j6Name}({content:\`${bodyForBuild}\`,isMeta:!0})])`;
      },
      'plan-file-reference',
      c => /plan_file_reference:\([$\w]+\)=>\[\]/.test(c)
    );
  },
};

const PLAN_MODE_EXIT_INJECTION: ReminderInjection = {
  id: 'plan-mode-exit',
  name: 'Plan-mode exit reminder',
  description:
    'Fires when leaving plan mode. Conditional. Empty .md body = silent exit.',
  placeholders: {
    plan_suffix: '${_}',
  },
  defaultBody:
    '## Exited Plan Mode\n\nYou have exited plan mode. You can now make edits, run tools, and take actions.{{plan_suffix}}',
  apply(content, body, isSuppressed) {
    return findAndReplace(
      content,
      /plan_mode_exit:\(([$\w]+)\)=>\{let ([$\w]+)=\1\.planExists\?` The plan file is located at \$\{\1\.planFilePath\} if you need to reference it\.`:"";return ([$\w]+)\(\[([$\w]+)\(\{content:`## Exited Plan Mode\n\nYou have exited plan mode\. You can now make edits, run tools, and take actions\.\$\{\2\}`,isMeta:!0\}\)\]\)\}/,
      m => {
        const [, hParam, suffixVar, o5Name, j6Name] = m;
        if (isSuppressed) return `plan_mode_exit:(${hParam})=>[]`;
        const bodyForBuild = body.replace(/\$\{_\}/g, `\${${suffixVar}}`);
        return `plan_mode_exit:(${hParam})=>{let ${suffixVar}=${hParam}.planExists?\` The plan file is located at \${${hParam}.planFilePath} if you need to reference it.\`:"";return ${o5Name}([${j6Name}({content:\`${bodyForBuild}\`,isMeta:!0})])}`;
      },
      'plan-mode-exit',
      c => /plan_mode_exit:\([$\w]+\)=>\[\]/.test(c)
    );
  },
};

const AUTO_MODE_EXIT_INJECTION: ReminderInjection = {
  id: 'auto-mode-exit',
  name: 'Auto-mode exit reminder',
  description:
    'Fires when leaving auto mode. Conditional. Empty .md body = silent exit.',
  placeholders: {},
  defaultBody:
    '## Exited Auto Mode\n\nYou have exited auto mode. The user may now want to interact more directly. You should ask clarifying questions when the approach is ambiguous rather than making assumptions.',
  apply(content, body, isSuppressed) {
    const newShape =
      /auto_mode_exit:\(([$\w]+)\)=>\{let ([$\w]+)=\1\.bashFirst\?(" [^"]*"):"",([$\w]+)=\1\.steerOnly\?(`[^`]*`):`## Exited Auto Mode\n\nYou have exited auto mode\. The user may now want to interact more directly\. You should ask clarifying questions when the approach is ambiguous rather than making assumptions\.\$\{\2\}`;return ([$\w]+)\(\[([$\w]+)\(\{content:\4,isMeta:!0\}\)\]\)\}/;
    if (newShape.test(content)) {
      return findAndReplace(
        content,
        newShape,
        m => {
          const [, eParam, tVar, bashNudge, rVar, steerArm, o5Name, j6Name] = m;
          if (isSuppressed) return `auto_mode_exit:(${eParam})=>[]`;
          return (
            `auto_mode_exit:(${eParam})=>{let ${tVar}=${eParam}.bashFirst?${bashNudge}:"",` +
            `${rVar}=${eParam}.steerOnly?${steerArm}:\`${body}\${${tVar}}\`;` +
            `return ${o5Name}([${j6Name}({content:${rVar},isMeta:!0})])}`
          );
        },
        'auto-mode-exit',
        c => /auto_mode_exit:\([$\w]+\)=>\[\]/.test(c)
      );
    }
    return findAndReplace(
      content,
      /auto_mode_exit:\(\)=>([$\w]+)\(\[([$\w]+)\(\{content:`## Exited Auto Mode\n\nYou have exited auto mode\. The user may now want to interact more directly\. You should ask clarifying questions when the approach is ambiguous rather than making assumptions\.`,isMeta:!0\}\)\]\)/,
      m => {
        const [, o5Name, j6Name] = m;
        if (isSuppressed) return 'auto_mode_exit:()=>[]';
        return `auto_mode_exit:()=>${o5Name}([${j6Name}({content:\`${body}\`,isMeta:!0})])`;
      },
      'auto-mode-exit',
      c => /auto_mode_exit:\(\)=>\[\]|auto_mode_exit:\([$\w]+\)=>\[\]/.test(c)
    );
  },
};

const NESTED_MEMORY_INJECTION: ReminderInjection = {
  id: 'nested-memory',
  name: 'Nested memory reference',
  description:
    'Loads a referenced memory file into context. Conditional. Empty .md body = nested memory invisible.',
  placeholders: {
    memory_path: '${H.content.path}',
    memory_content: '${H.content.content}',
  },
  defaultBody: 'Contents of {{memory_path}}:\n\n{{memory_content}}',
  apply(content, body, isSuppressed) {
    return findAndReplace(
      content,
      /nested_memory:\(([$\w]+)\)=>([$\w]+)\(\[([$\w]+)\(\{content:`Contents of \$\{\1\.content\.path\}:\n\n\$\{\1\.content\.content\}`,isMeta:!0\}\)\]\)/,
      m => {
        const [, hParam, o5Name, j6Name] = m;
        if (isSuppressed) return `nested_memory:(${hParam})=>[]`;
        const bodyForBuild = body
          .replace(/\$\{H\.content\.path\}/g, `\${${hParam}.content.path}`)
          .replace(
            /\$\{H\.content\.content\}/g,
            `\${${hParam}.content.content}`
          );
        return `nested_memory:(${hParam})=>${o5Name}([${j6Name}({content:\`${bodyForBuild}\`,isMeta:!0})])`;
      },
      'nested-memory',
      c => /nested_memory:\([$\w]+\)=>\[\]/.test(c)
    );
  },
};

const AGENT_MENTION_INJECTION: ReminderInjection = {
  id: 'agent-mention',
  name: 'Agent-mention nudge',
  description:
    'Nudges Claude to invoke an agent when user @-mentions one. Conditional. Empty .md body = silent (model decides on its own).',
  placeholders: {
    agent_type: '${H.agentType}',
  },
  defaultBody:
    'The user has expressed a desire to invoke the agent "{{agent_type}}". Please invoke the agent appropriately, passing in the required context to it. ',
  apply(content, body, isSuppressed) {
    return findAndReplace(
      content,
      /agent_mention:\(([$\w]+)\)=>([$\w]+)\(\[([$\w]+)\(\{content:`The user has expressed a desire to invoke the agent "\$\{\1\.agentType\}"\. Please invoke the agent appropriately, passing in the required context to it\. `,isMeta:!0\}\)\]\)/,
      m => {
        const [, hParam, o5Name, j6Name] = m;
        if (isSuppressed) return `agent_mention:(${hParam})=>[]`;
        const bodyForBuild = body.replace(
          /\$\{H\.agentType\}/g,
          `\${${hParam}.agentType}`
        );
        return `agent_mention:(${hParam})=>${o5Name}([${j6Name}({content:\`${bodyForBuild}\`,isMeta:!0})])`;
      },
      'agent-mention',
      c => /agent_mention:\([$\w]+\)=>\[\]/.test(c)
    );
  },
};

const MEMORY_UPDATE_INJECTION: ReminderInjection = {
  id: 'memory-update',
  name: 'Memory-update reminder',
  description:
    'Fires after dream / consolidation writes new memory files. Conditional. Empty .md body = silent updates.',
  shadows: ['system-reminder-memory-update-loaded-copy-stale'],
  placeholders: {
    source: '${YT3[H.source]}',
    summary: '${H.summary}',
    paths: '${H.paths.join(", ")}',
    in_context_paths: '${H.inContextPaths.join(", ")}',
  },
  defaultBody:
    '{{source}} updated your memory directory: {{summary}}\nFiles changed: {{paths}}\nYour loaded copy of {{in_context_paths}} is now stale relative to disk — Read it again if you need current contents.\nThis is ambient context — do not narrate it to the user unless they ask or it is directly relevant to their request.',
  apply(content, body, isSuppressed) {
    const found = findCaseBody(
      content,
      'memory_update',
      'updated your memory directory'
    );
    if (!found) {
      console.error('patch: reminder memory-update: failed to find case body');
      return null;
    }
    const { bodyStart, bodyEnd } = found;
    const caseBody = content.slice(bodyStart, bodyEnd);
    const { arrayWrap, msgCtor } = discoverWrappers(caseBody);
    const p = discoverDeltaParam(caseBody, 'summary');
    const sourceMap = caseBody.match(/\$\{([$\w]+)\[/)?.[1] ?? 'YT3';
    const bodyForBuild = body
      .replace(/\$\{YT3\[H\.source\]\}/g, `\${${sourceMap}[${p}.source]}`)
      .replace(/\$\{H\./g, `\${${p}.`);
    const newBody = isSuppressed
      ? 'return [];'
      : `return ${arrayWrap}([${msgCtor}({content:\`${bodyForBuild}\`,isMeta:!0})])`;
    const newContent =
      content.slice(0, bodyStart) + newBody + content.slice(bodyEnd);
    showDiff(content, newContent, newBody, bodyStart, bodyEnd);
    return newContent;
  },
};

const VERIFY_PLAN_INJECTION: ReminderInjection = {
  id: 'verify-plan-reminder',
  name: 'Verify-plan reminder',
  description:
    'Fires after plan implementation completes, directing Claude to call a verification tool. Conditional. Empty .md body = no automatic verification nudge.',
  placeholders: {
    plan_verifier_tool: '${J7}',
  },
  defaultBody:
    'You have completed implementing the plan. Please call the "" tool directly (NOT the {{plan_verifier_tool}} tool or an agent) to verify that all plan items were completed correctly.',
  apply(content, body, isSuppressed) {
    const found = findCaseBody(
      content,
      'verify_plan_reminder',
      'You have completed implementing the plan'
    );
    if (!found) {
      if (!content.includes('You have completed implementing the plan')) {
        return content;
      }
      console.error(
        'patch: reminder verify-plan-reminder: failed to find case body'
      );
      return null;
    }
    const { bodyStart, bodyEnd } = found;
    const caseBody = content.slice(bodyStart, bodyEnd);
    const { arrayWrap, msgCtor } = discoverWrappers(caseBody);
    const verifierTool =
      caseBody.match(/\(NOT the \$\{([$\w]+)\} tool/)?.[1] ?? 'J7';
    const bodyForBuild = body.replace(/\$\{J7\}/g, `\${${verifierTool}}`);
    const newBody = isSuppressed
      ? 'return [];'
      : `let K=\`${bodyForBuild}\`;return ${arrayWrap}([${msgCtor}({content:K,isMeta:!0})])`;
    const newContent =
      content.slice(0, bodyStart) + newBody + content.slice(bodyEnd);
    showDiff(content, newContent, newBody, bodyStart, bodyEnd);
    return newContent;
  },
};

export {
  SELECTED_LINES_INJECTION,
  OPENED_FILE_INJECTION,
  PLAN_FILE_REF_INJECTION,
  PLAN_MODE_EXIT_INJECTION,
  AUTO_MODE_EXIT_INJECTION,
  NESTED_MEMORY_INJECTION,
  AGENT_MENTION_INJECTION,
  MEMORY_UPDATE_INJECTION,
  VERIFY_PLAN_INJECTION,
};
