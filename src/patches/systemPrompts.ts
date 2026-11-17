import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../config';
import { debug, isVerbose } from '../utils';
import { showDiff, PatchGroup, PatchResult } from './index';
import { writeUserCooperation } from './userCooperation';
import {
  canonicalPromptEntries,
  promptBaseline,
} from '../systemPromptCatalogue';
import { loadSystemPromptsWithRegex } from '../systemPromptSync';
import {
  detectUnicodeEscaping,
  extractBuildTime,
  selectSpliceSiteAt,
} from '../systemPromptSites';
import { textAssetVisible } from '../nativeTextAssets';
import { matchesInRegion } from '../virtualBundle';
import {
  createPromptApplyState,
  LoadedPrompt,
  PromptApplyState,
  promptSiteKey,
  recordPromptResult,
  retainPromptSite,
  storePromptApplyHashes,
} from './systemPromptApplyState';
import { preparePromptReplacement } from './systemPromptApplyGuards';
import { handleMissingPrompt } from './systemPromptApplyDiagnostics';

export { isTweakccHumanName } from '../systemPromptSites';

export interface SystemPromptsResult {
  newContent: string;
  results: PatchResult[];
}

const visiblePrompts = (prompts: LoadedPrompt[]): LoadedPrompt[] => {
  const invisible = prompts.filter(entry => !textAssetVisible(entry.asset));
  if (invisible.length > 0) {
    console.log(
      chalk.yellow(
        `Skipping ${invisible.length} prompt(s) stored in zstd-compressed text ` +
          `assets: this Node (${process.version}) has no zstd. Node 22.15+ ` +
          'or 23.8+ can apply them.'
      )
    );
  }
  return prompts.filter(entry => textAssetVisible(entry.asset));
};

const promptLengthDetails = (difference: number): string => {
  if (difference > 0) return chalk.green(`${difference} fewer chars`);
  if (difference < 0) return chalk.red(`${Math.abs(difference)} more chars`);
  return 'unchanged';
};

const splicePrompt = (
  state: PromptApplyState,
  entry: LoadedPrompt,
  match: RegExpMatchArray,
  replacement: string
): void => {
  const start = match.index!;
  const end = start + match[0].length;
  const previous = isVerbose() ? state.working.toString() : null;
  if (replacement !== match[0]) {
    const key = promptSiteKey(entry);
    state.groupSpliced.set(key, (state.groupSpliced.get(key) ?? 0) + 1);
    state.working.splice(start, end, replacement);
    state.regions?.recordSplice(start, end, replacement.length);
    state.contentChanged = true;
    state.matchCatalog.recordSplice(state.working, {
      start,
      end,
      replacementLength: replacement.length,
    });
  } else {
    retainPromptSite(state, entry);
  }
  if (previous !== null) {
    showDiff(previous, state.working.toString(), replacement, start, end);
  }
};

const applyMatchedPrompt = (
  state: PromptApplyState,
  entry: LoadedPrompt,
  match: RegExpMatchArray
): void => {
  const delimiter = state.working.charAt(match.index! - 1);
  const replacement = preparePromptReplacement(state, entry, match, delimiter);
  if (replacement === null) return;
  splicePrompt(state, entry, match, replacement);
  recordPromptResult(
    state,
    entry,
    {
      applied: replacement !== match[0],
      details: promptLengthDetails(
        promptBaseline(entry).length - entry.prompt.content.trim().length
      ),
    },
    true
  );
};

const applyPrompt = async (
  state: PromptApplyState,
  entry: LoadedPrompt
): Promise<void> => {
  if (state.patchFilter && !state.patchFilter.includes(entry.promptId)) {
    recordPromptResult(state, entry, { skipped: true });
    return;
  }
  if (state.canonicalEntries.has(entry)) {
    debug(`"${entry.prompt.name}": still vanilla, leaving cli.js untouched`);
    retainPromptSite(state, entry);
    recordPromptResult(state, entry, { details: 'unchanged' }, true);
    return;
  }
  debug(`Applying system prompt: ${entry.prompt.name}`);
  const matches = matchesInRegion(
    await state.matchCatalog.matchCurrent(entry.regex, state.working),
    state.regions,
    Boolean(entry.asset)
  );
  const key = promptSiteKey(entry);
  const remaining =
    (state.groupMultiplicity.get(key) ?? 1) -
    (state.groupSpliced.get(key) ?? 0);
  const selected = selectSpliceSiteAt(
    matches,
    remaining,
    state.groupRetained.get(key) ?? 0,
    index => state.working.charAt(index)
  );
  if (selected.disambiguated) {
    debug(
      `Disambiguated ${matches.length} matches to ${remaining} standalone for "${entry.prompt.name}"`
    );
  }
  if (selected.ambiguous) {
    console.log(
      chalk.yellow(
        `"${entry.prompt.name}" matches ${matches.length} places in cli.js for ${remaining} ` +
          'catalogue entr' +
          (remaining === 1 ? 'y' : 'ies') +
          ' and none of them is identifiable, skipping rather than ' +
          'splicing into whichever came first'
      )
    );
    recordPromptResult(state, entry, {
      details: `${matches.length} ambiguous candidate sites - no site attributable to this prompt`,
    });
    return;
  }
  if (selected.match && selected.match.index !== undefined) {
    applyMatchedPrompt(state, entry, selected.match);
  } else {
    await handleMissingPrompt(state, entry);
  }
};

export const applySystemPrompts = async (
  content: string,
  version: string,
  escapeNonAscii?: boolean,
  patchFilter?: string[] | null,
  pristineContent?: string
): Promise<SystemPromptsResult> => {
  const shouldEscapeNonAscii = escapeNonAscii ?? detectUnicodeEscaping(content);
  if (shouldEscapeNonAscii) {
    debug(
      'Detected Unicode escaping in cli.js, will escape non-ASCII characters in prompts'
    );
  }
  const buildTime = extractBuildTime(content);
  if (buildTime) debug(`Extracted BUILD_TIME from cli.js: ${buildTime}`);
  const loaded = await loadSystemPromptsWithRegex(
    version,
    shouldEscapeNonAscii,
    buildTime
  );
  debug(`Loaded ${loaded.length} system prompts with regexes`);
  const prompts = visiblePrompts(loaded);
  const state = createPromptApplyState(
    content,
    prompts,
    canonicalPromptEntries(loaded),
    version,
    shouldEscapeNonAscii,
    buildTime,
    patchFilter,
    pristineContent
  );
  for (const [index, entry] of prompts.entries()) {
    for (const expired of state.expiringMatches.get(index - 1) ?? []) {
      state.matchCatalog.delete(expired);
    }
    await applyPrompt(state, entry);
  }
  await storePromptApplyHashes(state);
  const contentWithOverrides = state.working.toString();
  const policyFile = path.join(CONFIG_DIR, 'user-cooperation.md');
  if (patchFilter || !fs.existsSync(policyFile)) {
    return { newContent: contentWithOverrides, results: state.results };
  }
  const policy = fs.readFileSync(policyFile, 'utf8').trim();
  const newContent = writeUserCooperation(contentWithOverrides, policy);
  if (newContent === null) {
    throw new Error(
      'User cooperation policy requires one main selector, default builder and subagent assembler. ' +
        'The target source has missing or ambiguous sites. No patched source has been written.'
    );
  }
  state.results.push({
    id: 'user-cooperation',
    name: 'User cooperation policy',
    group: PatchGroup.SYSTEM_PROMPTS,
    applied: newContent !== contentWithOverrides,
    modelFacing: true,
    details: 'Main, teammate and subagent prompt paths',
  });
  return { newContent, results: state.results };
};
