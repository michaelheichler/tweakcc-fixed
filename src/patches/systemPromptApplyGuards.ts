import chalk from 'chalk';
import {
  encodeReplacementForDelimiter,
  needsDelimiterAwareEscaping,
} from '../systemPromptSync';
import { leakedPromptPlaceholders } from '../systemPromptSites';
import { debug } from '../utils';
import { PatchResult } from './index';
import {
  LoadedPrompt,
  PromptApplyState,
  recordPromptResult,
  retainPromptSite,
} from './systemPromptApplyState';

const placeholderFailure = (
  state: PromptApplyState,
  entry: LoadedPrompt,
  match: RegExpMatchArray,
  delimiter: string,
  content: string
): Partial<PatchResult> | null => {
  const leaked = leakedPromptPlaceholders(content, entry.prompt.content);
  const ownNames = new Set(Object.values(entry.identifierMap));
  const siblingNames = state.groupNames.get(entry.promptId);
  if (
    leaked.length > 0 &&
    leaked.every(name => !ownNames.has(name) && siblingNames?.has(name))
  ) {
    debug(
      `"${entry.prompt.name}": placeholders resolve via a same-id sibling shape`
    );
    return { skipped: true };
  }
  const drifted =
    delimiter === '`'
      ? leaked
      : leaked.filter(
          name =>
            !new RegExp('(?<!\\\\)\\$\\{' + name + '(?![A-Za-z0-9_])').test(
              match[0]
            )
        );
  if (drifted.length === 0) return null;
  console.log(
    chalk.red(
      `Unresolved placeholder \${${drifted[0]}} in "${entry.prompt.name}" (markdown vocabulary out of sync with CC ${state.version} prompt data) - skipping`
    )
  );
  return {
    details: `unresolved placeholder \${${drifted[0]}} - markdown out of sync with prompt data`,
  };
};

const delimiterFailure = (
  entry: LoadedPrompt,
  delimiter: string,
  content: string
): Partial<PatchResult> | null => {
  if (
    delimiter === '"' ||
    delimiter === "'" ||
    delimiter === '`' ||
    !needsDelimiterAwareEscaping(content)
  ) {
    return null;
  }
  console.log(
    chalk.yellow(
      `"${entry.prompt.name}" resolves inside a larger string literal (no delimiter at the ` +
        'match boundary) and its content needs delimiter-specific escaping - skipping'
    )
  );
  return {
    details: 'unresolvable string delimiter - cannot escape content safely',
  };
};

const interpolatePrompt = (
  state: PromptApplyState,
  entry: LoadedPrompt,
  match: RegExpMatchArray
): string | null => {
  try {
    return entry.getInterpolatedContent(match);
  } catch (error) {
    console.log(
      chalk.red(
        `Malformed \${...} interpolation in "${entry.prompt.name}" (${entry.promptId}.md): ` +
          `${error instanceof Error ? error.message : String(error)} - skipping`
      )
    );
    retainPromptSite(state, entry);
    recordPromptResult(state, entry, {
      failed: true,
      details: 'malformed ${...} interpolation in the markdown',
    });
    return null;
  }
};

export const preparePromptReplacement = (
  state: PromptApplyState,
  entry: LoadedPrompt,
  match: RegExpMatchArray,
  delimiter: string
): string | null => {
  const content = interpolatePrompt(state, entry, match);
  if (content === null) return null;
  const failure =
    placeholderFailure(state, entry, match, delimiter, content) ??
    delimiterFailure(entry, delimiter, content);
  if (failure) {
    retainPromptSite(state, entry);
    recordPromptResult(state, entry, failure);
    return null;
  }
  const encoded = encodeReplacementForDelimiter(
    content,
    delimiter,
    state.shouldEscapeNonAscii
  );
  if (encoded.incomplete) {
    console.log(
      chalk.red(
        `Incomplete backtick escaping for "${entry.prompt.name}" (unclosed interpolation) - skipping`
      )
    );
    retainPromptSite(state, entry);
    recordPromptResult(state, entry, {
      details: 'incomplete escaping: unclosed interpolation detected',
    });
    return null;
  }
  if (encoded.autoEscaped) {
    debug(`Auto-escaped unescaped backticks in "${entry.prompt.name}"`);
  }
  return encoded.content;
};
