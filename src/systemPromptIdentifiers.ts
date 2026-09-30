import {
  countPrecedingBackslashes,
  extractOriginalWhitespace,
  applyOriginalWhitespace,
} from './systemPromptEscaping';
import { escapeNonAsciiChars } from './systemPromptRegex';

interface CodeRegion {
  start: number;
  end: number;
}

const REGEX_LITERAL_PRECEDERS = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '~',
  '^',
  '<',
  '>',
  'n',
]);

const IDENT_CHAR = /[$\w]/;

const isRegexLiteralStart = (content: string, at: number): boolean => {
  let i = at - 1;
  while (i >= 0 && /\s/.test(content[i])) i--;
  if (i < 0) return true;
  const ch = content[i];
  if (ch === 'n') {
    return /(?:^|[^$\w])(?:return|in)$/.test(content.slice(0, i + 1));
  }
  return REGEX_LITERAL_PRECEDERS.has(ch);
};

const skipQuotedString = (
  content: string,
  start: number,
  quote: string
): number => {
  let i = start + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return -1;
};

const skipRegexLiteral = (content: string, start: number): number => {
  let i = start + 1;
  let inClass = false;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '\n') return -1;
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      i++;
      while (i < content.length && /[a-z]/i.test(content[i])) i++;
      return i;
    }
    i++;
  }
  return -1;
};

const scanInterpolation = (
  content: string,
  openIndex: number
): {
  end: number;
  codeRegions: CodeRegion[];
} | null => {
  const codeRegions: CodeRegion[] = [];
  const stack: Array<'expr' | 'template'> = ['expr'];
  let regionStart = openIndex + 2;
  let i = regionStart;
  const closeRegion = (at: number): void => {
    if (at > regionStart) codeRegions.push({ start: regionStart, end: at });
  };
  while (i < content.length) {
    const ch = content[i];
    if (stack[stack.length - 1] === 'template') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        stack.pop();
        i++;
        regionStart = i;
        continue;
      }
      if (ch === '$' && content[i + 1] === '{') {
        stack.push('expr');
        i += 2;
        regionStart = i;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '/' && content[i + 1] === '/') {
      closeRegion(i);
      const nl = content.indexOf('\n', i);
      i = nl === -1 ? content.length : nl;
      regionStart = i;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      closeRegion(i);
      const close = content.indexOf('*/', i + 2);
      if (close === -1) return null;
      i = close + 2;
      regionStart = i;
      continue;
    }
    if (ch === '/' && isRegexLiteralStart(content, i)) {
      closeRegion(i);
      const after = skipRegexLiteral(content, i);
      if (after === -1) return null;
      i = after;
      regionStart = i;
      continue;
    }
    if (ch === "'" || ch === '"') {
      closeRegion(i);
      const after = skipQuotedString(content, i, ch);
      if (after === -1) return null;
      i = after;
      regionStart = i;
      continue;
    }
    if (ch === '`') {
      closeRegion(i);
      stack.push('template');
      i++;
      continue;
    }
    if (ch === '{') {
      stack.push('expr');
      i++;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      if (stack.length === 0) {
        closeRegion(i);
        return { end: i, codeRegions };
      }
      if (stack[stack.length - 1] === 'template') {
        closeRegion(i);
        i++;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return null;
};

const prevMeaningfulIndex = (content: string, at: number): number => {
  let i = at - 1;
  while (i >= 0 && /\s/.test(content[i])) i--;
  return i;
};

const nextMeaningfulIndex = (content: string, at: number): number => {
  let i = at;
  while (i < content.length && /\s/.test(content[i])) i++;
  return i < content.length ? i : -1;
};

const isSubstitutableReference = (
  content: string,
  start: number,
  end: number
): boolean => {
  const prev = prevMeaningfulIndex(content, start);
  const prevCh = prev >= 0 ? content[prev] : '';
  const next = nextMeaningfulIndex(content, end);
  const nextCh = next >= 0 ? content[next] : '';
  if (nextCh === ':' && (prevCh === '{' || prevCh === ',')) return false;
  return true;
};

const substituteInInterpolations = (
  content: string,
  reverseMap: Record<string, string>
): string => {
  const regions: CodeRegion[] = [];
  for (let i = 0; i < content.length; i++) {
    if (
      content[i] !== '$' ||
      content[i + 1] !== '{' ||
      countPrecedingBackslashes(content, i) % 2 !== 0
    ) {
      continue;
    }
    const scanned = scanInterpolation(content, i);
    if (!scanned) {
      throw new Error(
        `applyIdentifierMapping: unbalanced \${...} interpolation at offset ${i}: ${JSON.stringify(content.slice(i, i + 80))}`
      );
    }
    regions.push(...scanned.codeRegions);
    i = scanned.end;
  }
  if (regions.length === 0) return content;
  let out = '';
  let cursor = 0;
  for (const region of regions) {
    out += content.slice(cursor, region.start);
    let i = region.start;
    while (i < region.end) {
      if (!IDENT_CHAR.test(content[i])) {
        out += content[i];
        i++;
        continue;
      }
      let j = i;
      while (j < region.end && IDENT_CHAR.test(content[j])) j++;
      const token = content.slice(i, j);
      if (
        Object.prototype.hasOwnProperty.call(reverseMap, token) &&
        isSubstitutableReference(content, i, j)
      ) {
        out += reverseMap[token];
      } else {
        out += token;
      }
      i = j;
    }
    cursor = region.end;
  }
  out += content.slice(cursor);
  return out;
};

export const applyIdentifierMapping = (
  content: string,
  identifiers: (number | string)[],
  identifierMap: Record<string, string>,
  extractedVars: string[],
  ccVersion: string,
  escapeNonAscii = false,
  buildTime?: string,
  pieces?: string[]
): string => {
  const reverseMap: Record<string, string> = {};
  for (let i = 0; i < extractedVars.length; i++) {
    const capturedVar = extractedVars[i];
    const labelIndex = String(identifiers[i]);
    const humanName = identifierMap[labelIndex] || `UNKNOWN_${labelIndex}`;
    reverseMap[humanName] = capturedVar;
  }
  let result = substituteInInterpolations(content, reverseMap);
  result = result.replace(/<<CCVERSION>>/g, ccVersion);
  if (buildTime) {
    result = result.replace(/<<BUILD_TIME>>/g, buildTime);
  }
  if (escapeNonAscii) {
    result = escapeNonAsciiChars(result);
  }
  if (pieces && pieces.length > 0) {
    const originalWhitespace = extractOriginalWhitespace(pieces);
    result = applyOriginalWhitespace(result, originalWhitespace);
  }
  return result;
};
export {
  CodeRegion,
  REGEX_LITERAL_PRECEDERS,
  IDENT_CHAR,
  isRegexLiteralStart,
  skipQuotedString,
  skipRegexLiteral,
  scanInterpolation,
  prevMeaningfulIndex,
  nextMeaningfulIndex,
  isSubstitutableReference,
  substituteInInterpolations,
};
