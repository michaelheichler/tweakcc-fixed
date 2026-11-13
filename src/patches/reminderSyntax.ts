export const CLOSERS: Record<string, string> = { '{': '}', '(': ')', '[': ']' };

export const matchingBrace = (content: string, openIdx: number): number => {
  const open = content[openIdx];
  const close = CLOSERS[open];
  if (close === undefined) return -1;
  let depth = 0;
  let inTpl = false;
  let inSingle = false;
  let inDouble = false;
  let inTplExpr = 0;
  for (let i = openIdx; i < content.length; i++) {
    const c = content[i];
    const prev = content[i - 1];
    if (inSingle) {
      if (c === '\\') i++;
      else if (c === "'") inSingle = false;
    } else if (inDouble) {
      if (c === '\\') i++;
      else if (c === '"') inDouble = false;
    } else if (inTpl) {
      if (c === '\\') i++;
      else if (c === '`' && inTplExpr === 0) inTpl = false;
      else if (c === '$' && content[i + 1] === '{') {
        inTplExpr++;
        i++;
      } else if (c === '}' && inTplExpr > 0) {
        inTplExpr--;
      }
    } else if (c === "'" && prev !== '\\') {
      inSingle = true;
    } else if (c === '"' && prev !== '\\') {
      inDouble = true;
    } else if (c === '`' && prev !== '\\') {
      inTpl = true;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

export const literalEnd = (src: string, i: number): number => {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') j++;
    else if (c === q) return j;
    else if (q === '`' && c === '$' && src[j + 1] === '{') {
      j = matchingBrace(src, j + 1);
      if (j < 0) return -1;
    }
  }
  return -1;
};

export const topLevelIndex = (
  src: string,
  from: number,
  stop: string
): number => {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      i = literalEnd(src, i);
      if (i < 0) return src.length;
    } else if (c in CLOSERS) {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && c === stop) {
      return i;
    }
  }
  return src.length;
};

export const splitTopLevel = (src: string, sep: string): string[] => {
  const parts: string[] = [];
  let from = 0;
  while (from <= src.length) {
    const at = topLevelIndex(src, from, sep);
    parts.push(src.slice(from, at));
    if (at >= src.length || src[at] !== sep) break;
    from = at + 1;
  }
  return parts;
};

export const interpolations = (tpl: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < tpl.length; i++) {
    if (tpl[i] === '\\') i++;
    else if (tpl[i] === '$' && tpl[i + 1] === '{') {
      const end = matchingBrace(tpl, i + 1);
      if (end < 0) break;
      out.push(tpl.slice(i + 2, end));
      i = end;
    }
  }
  return out;
};

export const escapeRe = (s: string): string =>
  s.replace(/[$.*+?^()[\]{}|\\]/g, '\\$&');
