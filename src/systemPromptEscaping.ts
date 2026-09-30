import { debug } from './utils';
import { escapeNonAsciiChars } from './systemPromptRegex';

const countPrecedingBackslashes = (content: string, pos: number): number => {
  let count = 0;
  let j = pos - 1;
  while (j >= 0 && content[j] === '\\') {
    count++;
    j--;
  }
  return count;
};

export const escapeDepthZeroBackticks = (
  content: string
): {
  content: string;
  incomplete: boolean;
} => {
  let out = '';
  let depth = 0;
  let inString = '';
  const templateStack: number[] = [];
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    const unescaped = countPrecedingBackslashes(content, i) % 2 === 0;
    if (depth) {
      const inTemplate =
        templateStack.length > 0 &&
        depth === templateStack[templateStack.length - 1];
      if (inTemplate) {
        if (ch === '`' && unescaped) {
          templateStack.pop();
        } else if (ch === '$' && next === '{') {
          if (unescaped) depth++;
          out += '${';
          i++;
          continue;
        }
        out += ch;
        continue;
      }
      if (!inString) {
        if (ch === '$' && next === '{') {
          if (unescaped) depth++;
          out += '${';
          i++;
          continue;
        } else if (ch === '"' || ch === "'") {
          inString = ch;
        } else if (ch === '`' && unescaped) {
          templateStack.push(depth);
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
        }
      } else if (ch === inString && unescaped) {
        inString = '';
      }
      out += ch;
      continue;
    }
    if (ch === '$' && next === '{' && !inString) {
      if (unescaped) depth++;
      out += '${';
      i++;
      continue;
    }
    if (ch === '`' && unescaped) {
      out += '\\`';
    } else {
      out += ch;
    }
  }
  const incomplete = depth > 0 || templateStack.length > 0;
  if (incomplete) {
    debug(
      `escapeDepthZeroBackticks: unclosed interpolation detected (depth=${depth}). Some backticks may not have been escaped.`
    );
  }
  return { content: out, incomplete };
};

const escapeUnescapedChar = (str: string, char: string): string => {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    if (str[i] === char) {
      let bs = 0;
      let j = i - 1;
      while (j >= 0 && str[j] === '\\') {
        bs++;
        j--;
      }
      result += bs % 2 === 0 ? '\\' + char : char;
    } else {
      result += str[i];
    }
  }
  return result;
};

export interface EncodedReplacement {
  content: string;
  incomplete: boolean;
  autoEscaped: boolean;
}

export const needsDelimiterAwareEscaping = (text: string): boolean =>
  /[\\`'"\r\n]/.test(text) || text.includes('${');

export const encodeReplacementForDelimiter = (
  text: string,
  delimiter: string,
  escapeNonAsciiOutput: boolean
): EncodedReplacement => {
  let out = text;
  let incomplete = false;
  let autoEscaped = false;
  if (delimiter === '"' || delimiter === "'") {
    out = out.replace(/\\/g, '\\\\');
    out = out.replace(/\r\n|\r|\n/g, '\\n');
    out = escapeUnescapedChar(out, delimiter);
  } else if (delimiter === '`') {
    out = out.replace(/\r\n|\r/g, '\n');
    const escaped = escapeDepthZeroBackticks(out);
    incomplete = escaped.incomplete;
    autoEscaped = escaped.content !== out;
    out = escaped.content;
  }
  if (escapeNonAsciiOutput) {
    out = escapeNonAsciiChars(out);
  }
  return { content: out, incomplete, autoEscaped };
};

export const extractOriginalWhitespace = (
  pieces: string[]
): {
  leading: string;
  trailing: string;
} => {
  if (pieces.length === 0) {
    return { leading: '', trailing: '' };
  }
  const firstPiece = pieces[0];
  const leadingMatch = firstPiece.match(/^(\s*)/);
  const leading = leadingMatch ? leadingMatch[1] : '';
  const lastPiece = pieces[pieces.length - 1];
  const trailingMatch = lastPiece.match(/(\s*)$/);
  const trailing = trailingMatch ? trailingMatch[1] : '';
  return { leading, trailing };
};

export const applyOriginalWhitespace = (
  userContent: string,
  originalWhitespace: {
    leading: string;
    trailing: string;
  }
): string => {
  if (userContent.trim() === '') {
    return '';
  }
  const trimmed = userContent.trim();
  return originalWhitespace.leading + trimmed + originalWhitespace.trailing;
};
export { countPrecedingBackslashes, escapeUnescapedChar };
