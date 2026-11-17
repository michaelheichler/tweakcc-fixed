import {
  parseExpressionAt,
  type CallExpression,
  type FunctionExpression,
  type ReturnStatement,
} from 'acorn';

const APPEND_NAME = 'tweakccUserCooperation';
const APPEND_FUNCTION =
  `function ${APPEND_NAME}(blocks,policy){` +
  'return blocks.includes(policy)?blocks:[...blocks,policy]}';

const ENTRY_PATTERNS = [
  /function\s+[$\w]+\(([$\w]+)\)\{let\{prompt:[$\w]+,servesDefault:[$\w]+\}=[$\w]+\(\1\);if\(/g,
  /async function\s+[$\w]+\([$\w]+,[$\w]+,[$\w]+\)\{let [$\w]+=await [^;]{0,450}\?\.isDetached===!0/g,
  /function\s+[$\w]+\([$\w]+,[$\w]+,[$\w]+\)\{let [^;]{0,300}Agent threads always have their cwd reset/g,
];

interface ReturnSite {
  start: number;
  end: number;
  expression: string;
}

const returnSite = (content: string, start: number): ReturnSite | null => {
  try {
    const fn = parseExpressionAt(content, start, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    }) as FunctionExpression;
    if (fn.type !== 'FunctionExpression') return null;
    const last = fn.body.body.at(-1) as ReturnStatement | undefined;
    if (last?.type !== 'ReturnStatement' || !last.argument) return null;
    let argument = last.argument;
    if (argument.type === 'CallExpression') {
      const call = argument as CallExpression;
      if (
        call.callee.type === 'FunctionExpression' &&
        call.callee.id?.name === APPEND_NAME
      ) {
        if (
          call.arguments.length !== 2 ||
          call.arguments[0].type === 'SpreadElement'
        ) {
          return null;
        }
        argument = call.arguments[0];
      }
    }
    return {
      start: last.argument.start,
      end: last.argument.end,
      expression: content.slice(argument.start, argument.end),
    };
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

export const writeUserCooperation = (
  content: string,
  policy: string
): string | null => {
  if (!policy.trim()) return content;
  const sites: ReturnSite[] = [];
  for (const pattern of ENTRY_PATTERNS) {
    const matches = [...content.matchAll(pattern)];
    if (matches.length !== 1) return null;
    const site = returnSite(content, matches[0].index!);
    if (!site) return null;
    sites.push(site);
  }
  const ordered = sites.sort((left, right) => right.start - left.start);
  let updated = content;
  for (const site of ordered) {
    const replacement = `(${APPEND_FUNCTION})(${site.expression},${JSON.stringify(policy)})`;
    updated =
      updated.slice(0, site.start) + replacement + updated.slice(site.end);
  }
  return updated;
};
