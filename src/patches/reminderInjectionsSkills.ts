import { topLevelIndex, literalEnd } from './reminderSyntax';
import { showDiff } from './index';
import { ReminderInjection } from './reminderShared';

export const SKILLS_DELTA_HEAD =
  /skill_listing:\(([$\w]+)\)=>\{if\(!\1\.content\)return\[\];let\[([$\w]+),([$\w]+)\]=([^;?]{1,200})\?\[(?:"(?:[^"\\]|\\.)*"|,)*\]:\[(?:"(?:[^"\\]|\\.)*"|,)*\];return ([$\w]+)\(\[([$\w]+)\(\{content:/;

export const SKILLS_DELTA_TAIL = ',isMeta:!0})])}';

export const applySkillsDelta = (
  content: string,
  body: string,
  isSuppressed: boolean
): string | null | undefined => {
  const m = content.match(SKILLS_DELTA_HEAD);
  if (!m || m.index === undefined) return undefined;
  const [, argParam, alsoVar, noteVar, addsCond] = m;
  const exprStart = m.index + m[0].length;
  const exprEnd = topLevelIndex(content, exprStart, ',');
  if (!content.startsWith(SKILLS_DELTA_TAIL, exprEnd)) {
    console.error(
      'patch: reminder skills-listing: skill_listing content expression has an unexpected shape'
    );
    return null;
  }
  const end = exprEnd + SKILLS_DELTA_TAIL.length;
  let replacement: string;
  if (isSuppressed) {
    replacement = `skill_listing:(${argParam})=>{return [];}`;
  } else {
    const expr = content.slice(exprStart, exprEnd);
    let scriptPart = '';
    let plainExpr = expr;
    const q = topLevelIndex(expr, 0, '?');
    if (q < expr.length) {
      const se = expr[q + 1] === '`' ? literalEnd(expr, q + 1) : -1;
      if (se < 0 || expr[se + 1] !== ':') {
        console.error(
          'patch: reminder skills-listing: failed to split the script-mode ternary'
        );
        return null;
      }
      scriptPart = expr.slice(0, se + 2);
      plainExpr = expr.slice(se + 2);
    }
    let pristinePlain: string | null = null;
    if (
      plainExpr[0] === '`' &&
      literalEnd(plainExpr, 0) === plainExpr.length - 1
    ) {
      pristinePlain = plainExpr;
    } else if (plainExpr.startsWith(`(${addsCond}?\``)) {
      const from = addsCond.length + 2;
      const pe = literalEnd(plainExpr, from);
      if (pe > 0) pristinePlain = plainExpr.slice(from, pe + 1);
    }
    if (pristinePlain === null) {
      console.error(
        'patch: reminder skills-listing: failed to find the plain skill_listing arm'
      );
      return null;
    }
    const names: Record<string, string> = {
      content: `${argParam}.content`,
      also: alsoVar,
      addsToEarlierNote: noteVar,
    };
    const userArm =
      '`' +
      body.replace(
        /\$\{H\.(content|also|addsToEarlierNote)\}/g,
        (_, k: string) => `\${${names[k]}}`
      ) +
      '`';
    const usesDelta = /\$\{H\.(?:also|addsToEarlierNote)\}/.test(body);
    const plain = usesDelta
      ? userArm
      : `(${addsCond}?${pristinePlain}:${userArm})`;
    replacement =
      content.slice(m.index, exprStart) +
      scriptPart +
      plain +
      SKILLS_DELTA_TAIL;
  }
  const newContent =
    content.slice(0, m.index) + replacement + content.slice(end);
  showDiff(content, newContent, replacement, m.index, end);
  return newContent;
};

export const SKILLS_INJECTION: ReminderInjection = {
  id: 'skills-listing',
  name: 'Skills listing reminder',
  description:
    'The "The following skills are available..." block. Empty .md body = suppress entirely.',
  placeholders: {
    skill_content: '${H.content}',
    also: '${H.also}',
    adds_to_earlier_note: '${H.addsToEarlierNote}',
  },
  previousDefaultBodies: [
    'The following skills are available for use with the Skill tool:\n\n{{skill_content}}',
  ],
  defaultBody: `The following skills are {{also}}available for use with the Skill tool{{adds_to_earlier_note}}:

{{skill_content}}`,
  apply(content, body, isSuppressed) {
    const method1 = applySkillsDelta(content, body, isSuppressed);
    if (method1 !== undefined) return method1;
    body = body.replace(/\$\{H\.(?:also|addsToEarlierNote)\}/g, '');
    const ternaryPattern =
      /skill_listing:\(([$\w]+)\)=>\{if\(!\1\.content\)return\[\];return ([$\w]+)\(\[([$\w]+)\(\{content:([^?`{}]{1,300})\?(`(?:[^`\\]|\\[\s\S])*`):`The following skills are available for use with the Skill tool:\n\n\$\{\1\.content\}`,isMeta:!0\}\)\]\)\}/;
    const plainPattern =
      /skill_listing:\(([$\w]+)\)=>\{if\(!\1\.content\)return\[\];return ([$\w]+)\(\[([$\w]+)\(\{content:`The following skills are available for use with the Skill tool:\n\n\$\{\1\.content\}`,isMeta:!0\}\)\]\)\}/;
    const match = content.match(ternaryPattern) ?? content.match(plainPattern);
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
    const [fullMatch, argParam, o5Name, j6Name, scriptCond, scriptArm] = match;
    let replacement: string;
    if (isSuppressed) {
      replacement = `skill_listing:(${argParam})=>{return [];}`;
    } else {
      const bodyForBuild = body.replace(/\$\{H\./g, `\${${argParam}.`);
      const plainArm = `\`${bodyForBuild}\``;
      const contentExpr =
        scriptCond !== undefined && scriptArm !== undefined
          ? `${scriptCond}?${scriptArm}:${plainArm}`
          : plainArm;
      replacement =
        `skill_listing:(${argParam})=>{` +
        `if(!${argParam}.content)return[];` +
        `return ${o5Name}([${j6Name}({content:${contentExpr},isMeta:!0})])}`;
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
