import { ReminderInjection, findAndReplace } from './reminderShared';

export const USER_NEW_MSG_FRAMING_VAR_SRC =
  '([$\\w]+)=`\\n\\nThis is how Claude Code surfaces messages the user sends mid-turn \\\\u2014 within the running turn, often alongside the next tool result, rather than as a separate conversation turn\\. Address the message above as you continue this turn\\.`';

export const USER_NEW_MSG_INJECTION: ReminderInjection = {
  id: 'user-sent-new-message',
  previousDefaultBodies: [
    "The user sent a new message while you were working:\n{{message}}\n\nIMPORTANT: After completing your current task, you MUST address the user's message above. Do not ignore it.",
  ],
  name: 'User-sent-new-message wrapper',
  description:
    'Wraps a user message that arrives mid-turn. Carries the "This is how Claude Code surfaces messages the user sends mid-turn … Address the message above as you continue this turn" framing (reworded in CC 2.1.205 from the old imperative "IMPORTANT: … you MUST address … Do not ignore it"). Empty .md = no wrapping (just the message text).',
  shadows: ['system-reminder-mid-turn-user-message-surfacing'],
  placeholders: {
    message: '${H}',
  },
  defaultBody: `The user sent a new message while you were working:
{{message}}

This is how Claude Code surfaces messages the user sends mid-turn \u2014 within the running turn, often alongside the next tool result, rather than as a separate conversation turn. Address the message above as you continue this turn.`,
  apply(content, body, isSuppressed) {
    const hoistedShape = new RegExp(
      '(' +
        USER_NEW_MSG_FRAMING_VAR_SRC +
        ';)function ([$\\w]+)\\(([$\\w]+)\\)\\{return`\\$\\{([$\\w]+)\\}\\$\\{\\4\\}\\$\\{\\2\\}`\\}' +
        'function ([$\\w]+)\\(([$\\w]+)\\)\\{return \\7\\.length>=\\5\\.length\\+\\2\\.length&&\\7\\.startsWith\\(\\5\\)&&\\7\\.endsWith\\(\\2\\)\\?\\7\\.slice\\(\\5\\.length,\\7\\.length-\\2\\.length\\):void 0\\}'
    );
    if (hoistedShape.test(content)) {
      return findAndReplace(
        content,
        hoistedShape,
        m => {
          const [
            ,
            framingDecl,
            ,
            wrapName,
            wrapParam,
            ,
            unwrapName,
            unwrapParam,
          ] = m;
          const tpl = isSuppressed ? '${H}' : body;
          const parts = tpl.split('${H}');
          const count = parts.length - 1;
          const wrapBody = parts.join(`\${${wrapParam}}`);
          const wrap = `function ${wrapName}(${wrapParam}){return\`${wrapBody}\`}`;
          const x = unwrapParam;
          const unwrap =
            count === 0
              ? `function ${unwrapName}(${x}){return void 0}`
              : `function ${unwrapName}(${x}){let __twUsrMsgP=\`${parts[0]}\`.length,` +
                `__twUsrMsgL=(${x}.length-${wrapName}("").length)/${count};` +
                `return __twUsrMsgL>=0&&Number.isInteger(__twUsrMsgL)&&` +
                `${wrapName}(${x}.slice(__twUsrMsgP,__twUsrMsgP+__twUsrMsgL))===${x}` +
                `?${x}.slice(__twUsrMsgP,__twUsrMsgP+__twUsrMsgL):void 0}`;
          return `${framingDecl}${wrap}${unwrap}`;
        },
        'user-sent-new-message'
      );
    }
    if (
      new RegExp(
        USER_NEW_MSG_FRAMING_VAR_SRC +
          ';function [$\\w]+\\([$\\w]+\\)\\{return`[\\s\\S]{0,20000}?`\\}function [$\\w]+\\([$\\w]+\\)\\{(?:let __twUsrMsgP=|return void 0\\})'
      ).test(content)
    ) {
      return content;
    }
    const fnShape =
      /(function [$\w]+\(([$\w]+)\)\{)return`\$\{[$\w]+\}\$\{\2\}\n\nThis is how Claude Code surfaces messages the user sends mid-turn \\u2014 within the running turn, often alongside the next tool result, rather than as a separate conversation turn\. Address the message above as you continue this turn\.`\}/;
    if (fnShape.test(content)) {
      return findAndReplace(
        content,
        fnShape,
        m => {
          const [, head, hParam] = m;
          if (isSuppressed) return `${head}return\`\${${hParam}}\`}`;
          const bodyForBuild = body.replace(/\$\{H\}/g, `\${${hParam}}`);
          return `${head}return\`${bodyForBuild}\`}`;
        },
        'user-sent-new-message'
      );
    }
    return findAndReplace(
      content,
      /((?:case"auto-continuation":)?case"human":case void 0:(?:default:)?)return`(?:The user sent a new message while you were working:\n|\$\{[$\w]+\})\$\{([$\w]+)\}\n\n(?:This is how Claude Code surfaces messages the user sends mid-turn \\u2014 within the running turn, often alongside the next tool result, rather than as a separate conversation turn\. Address the message above as you continue this turn\.|IMPORTANT: After completing your current task, you MUST address the user's message above\. Do not ignore it\.)`/,
      m => {
        const [, prefix, hParam] = m;
        if (isSuppressed) return `${prefix}return\`\${${hParam}}\``;
        const bodyForBuild = body.replace(/\$\{H\}/g, `\${${hParam}}`);
        return `${prefix}return\`${bodyForBuild}\``;
      },
      'user-sent-new-message',
      c =>
        /(?:case"auto-continuation":)?case"human":case void 0:(?:default:)?return`\$\{[$\w]+\}`/.test(
          c
        )
    );
  },
};
