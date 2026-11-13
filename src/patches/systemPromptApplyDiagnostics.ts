import chalk from 'chalk';
import { findAllPromptPieceMatches } from '../systemPromptPieceMatcher';
import { matchesInRegion } from '../virtualBundle';
import { debug, isVerbose, stringifyRegex, verbose } from '../utils';
import {
  LoadedPrompt,
  PromptApplyState,
  recordPromptResult,
} from './systemPromptApplyState';

const matchedBeforeEarlierSplice = async (
  state: PromptApplyState,
  entry: LoadedPrompt
): Promise<boolean> => {
  if (state.pristineContent === undefined || !state.contentChanged)
    return false;
  try {
    const spec = state.matchSpecs.get(entry.regex);
    return spec
      ? matchesInRegion(
          await findAllPromptPieceMatches(spec, state.pristineContent),
          state.pristineRegions,
          Boolean(entry.asset)
        ).length > 0
      : false;
  } catch {
    return false;
  }
};

const logMissingPrompt = (
  state: PromptApplyState,
  entry: LoadedPrompt
): void => {
  const { prompt, regex } = entry;
  if (
    !prompt.name.startsWith('Data:') &&
    prompt.name !== 'Skill: Build with Claude API'
  ) {
    console.log(
      chalk.yellow(
        entry.asset
          ? `Could not find system prompt "${prompt.name}" in cli.js (text asset ${entry.asset})`
          : `Could not find system prompt "${prompt.name}" in cli.js (using regex ${stringifyRegex(new RegExp(regex, 's'))})`
      )
    );
  }
  if (!isVerbose()) return;
  verbose(`\n  Debug info for ${prompt.name}:`);
  verbose(
    `  Regex pattern (first 200 chars): ${regex.substring(0, 200).replace(/\n/g, '\\n')}...`
  );
  verbose(`  Trying to match pattern in cli.js...`);
  try {
    const testMatch = state.working
      .toString()
      .match(new RegExp(regex.substring(0, 100)));
    verbose(
      `  Partial match result: ${testMatch ? 'found partial' : 'no match'}`
    );
  } catch {
    verbose(`  Partial match failed (regex truncation issue)`);
  }
};

export const handleMissingPrompt = async (
  state: PromptApplyState,
  entry: LoadedPrompt
): Promise<void> => {
  if (await matchedBeforeEarlierSplice(state, entry)) {
    debug(`"${entry.prompt.name}": region consumed by an earlier override`);
    recordPromptResult(state, entry, { skipped: true });
    return;
  }
  const platform = process.env.TWEAKCC_TARGET_PLATFORM || process.platform;
  if (
    Array.isArray(entry.platforms) &&
    entry.platforms.length > 0 &&
    !entry.platforms.includes(platform)
  ) {
    debug(`"${entry.prompt.name}": not in the ${platform} build`);
    recordPromptResult(state, entry, {
      skipped: true,
      details: `not in the ${platform} build`,
    });
    return;
  }
  logMissingPrompt(state, entry);
};
