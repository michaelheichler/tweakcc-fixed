import chalk from 'chalk';
import { debug, isVerbose, stringifyRegex, verbose } from '../utils';
import { showDiff, PatchResult, PatchGroup } from './index';
import {
  loadSystemPromptsWithRegex,
  reconstructContentFromPieces,
  encodeReplacementForDelimiter,
  loadIdentifierMapUnion,
} from '../systemPromptSync';
import {
  detectUnicodeEscaping,
  extractBuildTime,
  leakedPromptPlaceholders,
  pickMatchForSpliceAt,
} from '../systemPromptSites';
import { setAppliedHashes, computeMD5Hash } from '../systemPromptHashIndex';
import { MutableText } from '../mutableText';
import {
  findAllPromptPieceMatches,
  foldPromptMatchContent,
  PromptPieceMatcherCatalog,
  PromptMatchSpec,
} from '../systemPromptPieceMatcher';

export { isTweakccHumanName } from '../systemPromptSites';

/**
 * Result of applying system prompts
 */
export interface SystemPromptsResult {
  newContent: string;
  results: PatchResult[];
}

/**
 * Apply system prompt customizations to cli.js content
 * @param content - The current content of cli.js
 * @param version - The Claude Code version
 * @param escapeNonAscii - Whether to escape non-ASCII characters (auto-detected if not specified)
 * @param patchFilter - Optional list of patch/prompt IDs to apply (if provided, only matching prompts are applied)
 * @returns SystemPromptsResult with modified content and per-prompt results
 */
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
      'Detected Unicode escaping in cli.js - will escape non-ASCII characters in prompts'
    );
  }

  const buildTime = extractBuildTime(content);
  if (buildTime) {
    debug(`Extracted BUILD_TIME from cli.js: ${buildTime}`);
  }

  const systemPrompts = await loadSystemPromptsWithRegex(
    version,
    shouldEscapeNonAscii,
    buildTime
  );
  debug(`Loaded ${systemPrompts.length} system prompts with regexes`);
  const firstPristineById = new Map<string, string>();
  const promptSiteCounts = new Map<string, number>();
  for (const entry of systemPrompts) {
    promptSiteCounts.set(
      entry.promptId,
      (promptSiteCounts.get(entry.promptId) ?? 0) + 1
    );
    if (!firstPristineById.has(entry.promptId)) {
      firstPristineById.set(
        entry.promptId,
        reconstructContentFromPieces(
          entry.pieces,
          entry.identifiers,
          entry.identifierMap
        ).trim()
      );
    }
  }
  const pristinePromptIds = new Set(
    systemPrompts
      .filter(
        entry =>
          (promptSiteCounts.get(entry.promptId) ?? 0) > 1 &&
          entry.prompt.content.trim() === firstPristineById.get(entry.promptId)
      )
      .map(entry => entry.promptId)
  );
  const matchSpecs = new Map<string, PromptMatchSpec>();
  for (const entry of systemPrompts) {
    matchSpecs.set(entry.regex, {
      regex: entry.regex,
      pieces: entry.pieces,
      version,
      buildTime,
    });
  }
  const matchCatalog = new PromptPieceMatcherCatalog([...matchSpecs.values()]);
  matchCatalog.index(content, foldPromptMatchContent(content));
  const lastMatchUse = new Map<string, number>();
  systemPrompts.forEach((entry, index) => {
    lastMatchUse.set(entry.regex, index);
  });
  const expiringMatches = new Map<number, string[]>();
  for (const [regex, index] of lastMatchUse) {
    const current = expiringMatches.get(index);
    if (current) current.push(regex);
    else expiringMatches.set(index, [regex]);
  }
  const working = new MutableText(content);
  let contentChanged =
    pristineContent !== undefined && pristineContent !== content;

  const identifierMapUnion = await loadIdentifierMapUnion();

  const groupNames = new Map<string, Set<string>>();
  for (const sp of systemPrompts) {
    let names = groupNames.get(sp.promptId);
    if (!names) {
      names = new Set();
      groupNames.set(sp.promptId, names);
    }
    for (const v of Object.values(sp.identifierMap)) names.add(v);
  }

  const results: PatchResult[] = [];
  const appliedHashUpdates: Record<string, string> = {};
  const hashResultIndexes: number[] = [];

  for (const [promptIndex, entry] of systemPrompts.entries()) {
    for (const expired of expiringMatches.get(promptIndex - 1) ?? []) {
      matchCatalog.delete(expired);
    }
    const {
      promptId,
      prompt,
      regex,
      getInterpolatedContent,
      pieces,
      identifiers,
      identifierMap,
    } = entry;
    if (patchFilter && !patchFilter.includes(promptId)) {
      results.push({
        id: promptId,
        name: prompt.name,
        group: PatchGroup.SYSTEM_PROMPTS,
        applied: false,
        skipped: true,
      });
      continue;
    }

    if (pristinePromptIds.has(promptId)) {
      const resultIndex = results.length;
      appliedHashUpdates[promptId] = computeMD5Hash(prompt.content);
      results.push({
        id: promptId,
        name: prompt.name,
        group: PatchGroup.SYSTEM_PROMPTS,
        applied: false,
        skipped: true,
        details: 'unchanged',
      });
      hashResultIndexes.push(resultIndex);
      continue;
    }

    debug(`Applying system prompt: ${prompt.name}`);
    const pattern = new RegExp(regex, 'si'); // 's' flag for dotAll mode, 'i' because of casing inconsistencies in unicode escape sequences (e.g. `\u201C` in the regex vs `\u201C` in the file)

    const allMatches = await matchCatalog.matchCurrent(regex, working);
    const { match, disambiguated } = pickMatchForSpliceAt(allMatches, index =>
      working.charAt(index)
    );
    if (disambiguated) {
      debug(
        `Disambiguated ${allMatches.length} matches \u2192 1 standalone for "${prompt.name}"`
      );
    }

    if (match && match.index !== undefined) {
      const interpolatedContent = getInterpolatedContent(match);

      const matchIndex = match.index;
      const delimiter = working.charAt(matchIndex - 1);

      {
        const leaked = leakedPromptPlaceholders(
          interpolatedContent,
          prompt.content,
          identifierMapUnion
        );

        const ownNames = new Set(Object.values(identifierMap));
        const siblingNames = groupNames.get(promptId);
        if (
          leaked.length > 0 &&
          leaked.every(n => !ownNames.has(n) && siblingNames?.has(n))
        ) {
          debug(
            `"${prompt.name}": placeholders resolve via a same-id sibling shape — leaving this site pristine`
          );
          results.push({
            id: promptId,
            name: prompt.name,
            group: PatchGroup.SYSTEM_PROMPTS,
            applied: false,
            skipped: true,
          });
          continue;
        }

        if (delimiter === '`' && leaked.length > 0) {
          console.log(
            chalk.red(
              `Unresolved placeholder \${${leaked[0]}} in "${prompt.name}" (markdown vocabulary out of sync with CC ${version} prompt data) - skipping`
            )
          );
          results.push({
            id: promptId,
            name: prompt.name,
            group: PatchGroup.SYSTEM_PROMPTS,
            applied: false,
            details: `unresolved placeholder \${${leaked[0]}} - markdown out of sync with prompt data`,
          });
          continue;
        }
      }

      const originalBaselineContent = reconstructContentFromPieces(
        pieces,
        identifiers,
        identifierMap
      ).trim();
      const originalLength = originalBaselineContent.length;
      const newLength = prompt.content.trim().length;

      const verboseOldContent = isVerbose() ? working.toString() : null;
      const matchLength = match[0].length;

      const encoded = encodeReplacementForDelimiter(
        interpolatedContent,
        delimiter,
        shouldEscapeNonAscii
      );
      if (encoded.incomplete) {
        console.log(
          chalk.red(
            `Incomplete backtick escaping for "${prompt.name}" (unclosed interpolation) - skipping`
          )
        );
        results.push({
          id: promptId,
          name: prompt.name,
          group: PatchGroup.SYSTEM_PROMPTS,
          applied: false,
          details: 'incomplete escaping: unclosed interpolation detected',
        });
        continue;
      }
      if (encoded.autoEscaped) {
        debug(`Auto-escaped unescaped backticks in "${prompt.name}"`);
      }
      const replacementContent = encoded.content;

      if (replacementContent !== match[0]) {
        working.splice(
          matchIndex,
          matchIndex + matchLength,
          replacementContent
        );
        contentChanged = true;
        matchCatalog.recordSplice(working, {
          start: matchIndex,
          end: matchIndex + matchLength,
          replacementLength: replacementContent.length,
        });
      }

      const appliedHash = computeMD5Hash(prompt.content);
      appliedHashUpdates[promptId] = appliedHash;

      if (verboseOldContent !== null) {
        showDiff(
          verboseOldContent,
          working.toString(),
          replacementContent,
          matchIndex,
          matchIndex + matchLength
        );
      }

      const charDiff = originalLength - newLength;
      const applied = replacementContent !== match[0];

      let details: string;
      if (charDiff > 0) {
        details = chalk.green(`${charDiff} fewer chars`);
      } else if (charDiff < 0) {
        details = chalk.red(`${Math.abs(charDiff)} more chars`);
      } else {
        details = 'unchanged';
      }

      const resultIndex = results.length;
      results.push({
        id: promptId,
        name: prompt.name,
        group: PatchGroup.SYSTEM_PROMPTS,
        applied,
        details,
      });
      hashResultIndexes.push(resultIndex);
    } else {
      let clobberedByEarlierSplice = false;
      if (pristineContent !== undefined && contentChanged) {
        try {
          const spec = matchSpecs.get(regex);
          const matchedPristine = spec
            ? await findAllPromptPieceMatches(spec, pristineContent)
            : [];
          clobberedByEarlierSplice = matchedPristine.length > 0;
        } catch {
          clobberedByEarlierSplice = false;
        }
      }

      if (clobberedByEarlierSplice) {
        debug(
          `"${prompt.name}": region consumed by an earlier inline-blob/reminder override — leaving superseded, no warning`
        );
        results.push({
          id: promptId,
          name: prompt.name,
          group: PatchGroup.SYSTEM_PROMPTS,
          applied: false,
          skipped: true,
        });
        continue;
      }

      if (
        !prompt.name.startsWith('Data:') &&
        prompt.name !== 'Skill: Build with Claude API'
      ) {
        console.log(
          chalk.yellow(
            `Could not find system prompt "${prompt.name}" in cli.js (using regex ${stringifyRegex(pattern)})`
          )
        );
      }

      if (isVerbose()) {
        verbose(`\n  Debug info for ${prompt.name}:`);
        verbose(
          `  Regex pattern (first 200 chars): ${regex.substring(0, 200).replace(/\n/g, '\\n')}...`
        );
        verbose(`  Trying to match pattern in cli.js...`);
        try {
          const testMatch = working
            .toString()
            .match(new RegExp(regex.substring(0, 100)));
          verbose(
            `  Partial match result: ${testMatch ? 'found partial' : 'no match'}`
          );
        } catch {
          verbose(`  Partial match failed (regex truncation issue)`);
        }
      }
    }
  }

  try {
    await setAppliedHashes(appliedHashUpdates);
  } catch (error) {
    debug(`Failed to store applied prompt hashes: ${error}`);
    for (const index of hashResultIndexes) {
      const result = results[index];
      if (!result) continue;
      result.failed = true;
      result.details = result.details
        ? `${result.details} (hash storage failed)`
        : 'hash storage failed';
    }
  }

  return {
    newContent: working.toString(),
    results,
  };
};
