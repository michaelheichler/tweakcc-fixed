import { escapeNonAscii } from './utils';

const hexAlt = (hex: string): string =>
  hex
    .split('')
    .map(c => (/[a-f]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c))
    .join('');

const escapeNonAsciiForRegex = (text: string): string => {
  return text.replace(/[\u0080-\uFFFF]/g, char => {
    const codePoint = char.charCodeAt(0);
    const literal = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const uForm = `\\\\u${hexAlt(codePoint.toString(16).padStart(4, '0'))}`;
    const alts = [literal, uForm];
    if (codePoint <= 0xff) {
      alts.push(`\\\\x${hexAlt(codePoint.toString(16).padStart(2, '0'))}`);
    }
    return `(?:${alts.join('|')})`;
  });
};

export const escapeNonAsciiChars = (text: string): string =>
  escapeNonAscii(text);

export const buildSearchRegexFromPieces = (
  pieces: string[],
  ccVersion: string,
  buildTime?: string
): string => {
  let pattern = '';
  const INTERP_SENTINEL = '\x00INTERP\x00';
  const BS_SENTINEL = '\x00BS\x00';
  const MEMBER_SENTINEL = '\x00MEMBER\x00';
  const MEMBER_PREFIX_SENTINEL = '\x00MEMBERPFX\x00';
  for (let i = 0; i < pieces.length; i++) {
    let piece = pieces[i].replace(/<<CCVERSION>>/g, ccVersion);
    if (buildTime) {
      piece = piece.replace(/<<BUILD_TIME>>/g, buildTime);
    }
    if (i > 0) {
      piece = piece.replace(
        /^\[[A-Za-z_$][\w$]*\](?=\}|\.[A-Za-z_$][\w$]*|[):,;?\]]|$)/,
        MEMBER_SENTINEL
      );
      piece = piece.replace(
        /^\[[A-Za-z_$][\w$]*((?:\.[\w$]+)+|\s*[-+*/%]\s*[^\]]*)\](?=\}|\.[A-Za-z_$][\w$]*|[):,;?\]]|$)/,
        (_m, tail) => `${MEMBER_PREFIX_SENTINEL}${tail}]`
      );
    }
    piece = piece.replace(/\$\{[^{}]*\}/g, INTERP_SENTINEL);
    piece = piece.replace(/\\/g, BS_SENTINEL);
    const escapedPiece = piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const withNonAsciiHandling = escapeNonAsciiForRegex(escapedPiece);
    const withDelimHandling = withNonAsciiHandling
      .replace(/"/g, '(?:"|\\\\")')
      .replace(/'/g, "(?:'|\\\\')")
      .replace(/`/g, '(?:`|\\\\`)');
    const withNewlineHandling = withDelimHandling.replace(
      /\n/g,
      '(?:\n|\\\\n)'
    );
    const withInterpHandling = withNewlineHandling.replace(
      new RegExp(INTERP_SENTINEL, 'g'),
      '\\$\\{[^{}]*\\}'
    );
    const withBackslashHandling = withInterpHandling.replace(
      new RegExp(BS_SENTINEL, 'g'),
      '(?:\\\\|\\\\\\\\)'
    );
    const withMemberHandling = withBackslashHandling.replace(
      new RegExp(MEMBER_SENTINEL, 'g'),
      '\\[[\\w$]+\\]'
    );
    const withMemberPrefixHandling = withMemberHandling.replace(
      new RegExp(MEMBER_PREFIX_SENTINEL, 'g'),
      '\\[[\\w$]+'
    );
    pattern += withMemberPrefixHandling;
    if (i < pieces.length - 1) {
      pattern += '([\\w$]+)';
    }
  }
  return pattern;
};
export { hexAlt, escapeNonAsciiForRegex };
