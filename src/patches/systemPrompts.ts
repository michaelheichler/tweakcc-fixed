import chalk from 'chalk';
import { debug, isVerbose, stringifyRegex, verbose } from '../utils';
import { showDiff, PatchResult, PatchGroup } from './index';
import {
  loadSystemPromptsWithRegex,
  reconstructContentFromPieces,
  encodeReplacementForDelimiter,
  needsDelimiterAwareEscaping,
} from '../systemPromptSync';
import {
  detectUnicodeEscaping,
  extractBuildTime,
  leakedPromptPlaceholders,
  selectSpliceSiteAt,
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

  const groupNames = new Map<string, Set<string>>();
  for (const sp of systemPrompts) {
    let names = groupNames.get(sp.promptId);
    if (!names) {
      names = new Set();
      groupNames.set(sp.promptId, names);
    }
    for (const v of Object.values(sp.identifierMap)) names.add(v);
  }

  // Catalogue multiplicity per shape group, grouped by regex exactly as the
  // preflight groups it: several entries can share one regex, one per binary
  // site. `retained` counts the group's entries that resolved to a site and
  // left its bytes alone (uncustomized, or skipped by a guard) — those sites
  // still match, so the next entry has to index past them. `spliced` counts the
  // sites that are gone from the match list. See selectSpliceSiteAt.
  const groupMultiplicity = new Map<string, number>();
  for (const sp of systemPrompts) {
    if (patchFilter && !patchFilter.includes(sp.promptId)) continue;
    groupMultiplicity.set(sp.regex, (groupMultiplicity.get(sp.regex) ?? 0) + 1);
  }
  const groupRetained = new Map<string, number>();
  const groupSpliced = new Map<string, number>();

  // Track per-prompt results
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
    // 's' for dotAll. No 'i': escapeNonAsciiForRegex already matches both hex
    // casings of a `\uXXXX` escape, and a case-insensitive prompt regex
    // over-matches its own prose (see foldPromptMatchContent).
    const pattern = new RegExp(regex, 's');

    const allMatches = await matchCatalog.matchCurrent(regex, working);
    const multiplicity = groupMultiplicity.get(regex) ?? 1;
    const retained = groupRetained.get(regex) ?? 0;
    const remaining = multiplicity - (groupSpliced.get(regex) ?? 0);
    const { match, ambiguous, disambiguated } = selectSpliceSiteAt(
      allMatches,
      remaining,
      retained,
      index => working.charAt(index)
    );
    if (disambiguated) {
      debug(
        `Disambiguated ${allMatches.length} matches \u2192 ${remaining} standalone for "${prompt.name}"`
      );
    }

    if (ambiguous) {
      console.log(
        chalk.yellow(
          `"${prompt.name}" matches ${allMatches.length} places in cli.js for ${remaining} ` +
            'catalogue entr' +
            (remaining === 1 ? 'y' : 'ies') +
            ' and none of them is identifiable \u2014 skipping rather than ' +
            'splicing into whichever came first'
        )
      );
      results.push({
        id: promptId,
        name: prompt.name,
        group: PatchGroup.SYSTEM_PROMPTS,
        applied: false,
        details: `${allMatches.length} ambiguous candidate sites - no site attributable to this prompt`,
      });
      continue;
    }

    if (match && match.index !== undefined) {
      // reconstructContentFromPieces produced the .md body in the first place,
      // so an untouched file still equals it and there is nothing to apply.
      // Re-encoding it anyway is not safe: the .md is a hybrid of decoded
      // quotes and raw JavaScript escapes, so the escaping passes below are not
      // its inverse \u2014 they double a backslash that was already literal prompt
      // text and emit `\uXXXX` where the bundle had `\xHH` or an uppercase
      // escape, rewriting prompts nobody customized on every apply (#922).
      // Leaving the site untouched is both correct and the only form guaranteed
      // to survive the round trip. Compared trimmed because the markdown round
      // trip is only trim-stable: gray-matter normalises the trailing newline,
      // and applyOriginalWhitespace already treats the edges as serialization.
      const originalBaselineContent = reconstructContentFromPieces(
        pieces,
        identifiers,
        identifierMap
      ).trim();
      if (prompt.content.trim() === originalBaselineContent) {
        debug(
          `"${prompt.name}": still vanilla \u2014 leaving cli.js untouched`
        );
        groupRetained.set(regex, retained + 1);
        appliedHashUpdates[promptId] = computeMD5Hash(prompt.content);
        results.push({
          id: promptId,
          name: prompt.name,
          group: PatchGroup.SYSTEM_PROMPTS,
          applied: false,
          details: 'unchanged',
        });
        hashResultIndexes.push(results.length - 1);
        continue;
      }
      // Generate the interpolated content using the actual variables from the
      // match. `substituteInInterpolations` throws on a malformed `${` — an
      // unclosed brace, an apostrophe inside one, a comment — all of which are
      // plausible authored text ("cost is ${100 for a run"). Uncaught, that
      // propagated out of the whole apply as a bare stack trace naming no
      // prompt, on native AFTER the extract step. Catch it here, where the id
      // is known, and skip only the offending override.
      let interpolatedContent: string;
      try {
        interpolatedContent = getInterpolatedContent(match);
      } catch (error) {
        console.log(
          chalk.red(
            `Malformed \${...} interpolation in "${prompt.name}" (${promptId}.md): ` +
              `${error instanceof Error ? error.message : String(error)} - skipping`
          )
        );
        groupRetained.set(regex, retained + 1);
        results.push({
          id: promptId,
          name: prompt.name,
          group: PatchGroup.SYSTEM_PROMPTS,
          applied: false,
          failed: true,
          details: 'malformed ${...} interpolation in the markdown',
        });
        continue;
      }

      const matchIndex = match.index;
      const delimiter = working.charAt(matchIndex - 1);

      {
        const leaked = leakedPromptPlaceholders(
          interpolatedContent,
          prompt.content
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
          groupRetained.set(regex, retained + 1);
          results.push({
            id: promptId,
            name: prompt.name,
            group: PatchGroup.SYSTEM_PROMPTS,
            applied: false,
            skipped: true,
          });
          continue;
        }

        const pristineSpan = match[0];
        const driftedNames =
          delimiter === '`'
            ? leaked
            : leaked.filter(
                name =>
                  !new RegExp(
                    '(?<!\\\\)\\$\\{' + name + '(?![A-Za-z0-9_])'
                  ).test(pristineSpan)
              );
        if (driftedNames.length > 0) {
          leaked.splice(0, leaked.length, ...driftedNames);
          console.log(
            chalk.red(
              `Unresolved placeholder \${${leaked[0]}} in "${prompt.name}" (markdown vocabulary out of sync with CC ${version} prompt data) - skipping`
            )
          );
          groupRetained.set(regex, retained + 1);
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

      // Guard: the delimiter is read from the single character before the
      // match, which only names the enclosing literal when the match IS the
      // whole literal value. At a site that is a fragment of a longer literal
      // that character is arbitrary and encodeReplacementForDelimiter has no
      // branch for it, so the body would be embedded with no escaping at all —
      // one raw backtick or `${` there terminates a template literal early and
      // leaves the rest of cli.js as floating syntax ("Expected CommonJS module
      // to have a function wrapper" at launch). Text that needs no
      // delimiter-specific escaping is inert in any of the three literal kinds
      // and still applies.
      if (
        delimiter !== '"' &&
        delimiter !== "'" &&
        delimiter !== '`' &&
        needsDelimiterAwareEscaping(interpolatedContent)
      ) {
        console.log(
          chalk.yellow(
            `"${prompt.name}" resolves inside a larger string literal (no delimiter at the ` +
              'match boundary) and its content needs delimiter-specific escaping - skipping'
          )
        );
        groupRetained.set(regex, retained + 1);
        results.push({
          id: promptId,
          name: prompt.name,
          group: PatchGroup.SYSTEM_PROMPTS,
          applied: false,
          details:
            'unresolvable string delimiter - cannot escape content safely',
        });
        continue;
      }

      // Calculate character counts for this prompt (both with human-readable placeholders)
      // Note: trim() to match how markdown files are parsed and how whitespace is applied
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
        groupRetained.set(regex, retained + 1);
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
        groupSpliced.set(regex, (groupSpliced.get(regex) ?? 0) + 1);
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
      } else {
        // Same bytes: the site keeps matching, so the group's next entry must
        // index past it rather than resolve to it again.
        groupRetained.set(regex, retained + 1);
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

      const targetPlatform =
        process.env.TWEAKCC_TARGET_PLATFORM || process.platform;
      if (
        Array.isArray(entry.platforms) &&
        entry.platforms.length > 0 &&
        !entry.platforms.includes(targetPlatform)
      ) {
        debug(
          `"${prompt.name}": not in the ${targetPlatform} build (platforms: ${entry.platforms.join(', ')}) — skipping`
        );
        results.push({
          id: promptId,
          name: prompt.name,
          group: PatchGroup.SYSTEM_PROMPTS,
          applied: false,
          skipped: true,
          details: `not in the ${targetPlatform} build`,
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
