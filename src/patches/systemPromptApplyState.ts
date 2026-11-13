import {
  loadSystemPromptsWithRegex,
  reconstructContentFromPieces,
} from '../systemPromptSync';
import { MutableText } from '../mutableText';
import {
  foldPromptMatchContent,
  PromptPieceMatcherCatalog,
  PromptMatchSpec,
} from '../systemPromptPieceMatcher';
import { BundleRegions } from '../virtualBundle';
import { computeMD5Hash, setAppliedHashes } from '../systemPromptHashIndex';
import { debug } from '../utils';
import { PatchGroup, PatchResult } from './index';

export type LoadedPrompt = Awaited<
  ReturnType<typeof loadSystemPromptsWithRegex>
>[number];

export interface PromptApplyState {
  version: string;
  shouldEscapeNonAscii: boolean;
  patchFilter?: string[] | null;
  pristineContent?: string;
  working: MutableText;
  contentChanged: boolean;
  regions: BundleRegions | null;
  pristineRegions: BundleRegions | null;
  matchSpecs: Map<string, PromptMatchSpec>;
  matchCatalog: PromptPieceMatcherCatalog;
  expiringMatches: Map<number, string[]>;
  pristinePromptIds: Set<string>;
  groupNames: Map<string, Set<string>>;
  groupMultiplicity: Map<string, number>;
  groupRetained: Map<string, number>;
  groupSpliced: Map<string, number>;
  results: PatchResult[];
  appliedHashUpdates: Record<string, string>;
  hashResultIndexes: number[];
}

export const promptSiteKey = (entry: LoadedPrompt): string =>
  (entry.asset ? 'asset:' : 'js:') + entry.regex;

export const promptBaseline = (entry: LoadedPrompt): string =>
  reconstructContentFromPieces(
    entry.pieces,
    entry.identifiers,
    entry.identifierMap
  ).trim();

const sharedPristinePromptIds = (prompts: LoadedPrompt[]): Set<string> => {
  const firstPristineById = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const entry of prompts) {
    counts.set(entry.promptId, (counts.get(entry.promptId) ?? 0) + 1);
    if (!firstPristineById.has(entry.promptId)) {
      firstPristineById.set(entry.promptId, promptBaseline(entry));
    }
  }
  return new Set(
    prompts
      .filter(
        entry =>
          (counts.get(entry.promptId) ?? 0) > 1 &&
          entry.prompt.content.trim() === firstPristineById.get(entry.promptId)
      )
      .map(entry => entry.promptId)
  );
};

const matchExpiryIndexes = (prompts: LoadedPrompt[]): Map<number, string[]> => {
  const lastUse = new Map<string, number>();
  prompts.forEach((entry, index) => lastUse.set(entry.regex, index));
  const expiring = new Map<number, string[]>();
  for (const [regex, index] of lastUse) {
    const current = expiring.get(index);
    if (current) current.push(regex);
    else expiring.set(index, [regex]);
  }
  return expiring;
};

const promptGroups = (prompts: LoadedPrompt[], filter?: string[] | null) => {
  const names = new Map<string, Set<string>>();
  const multiplicity = new Map<string, number>();
  for (const entry of prompts) {
    let groupNames = names.get(entry.promptId);
    if (!groupNames) {
      groupNames = new Set();
      names.set(entry.promptId, groupNames);
    }
    for (const name of Object.values(entry.identifierMap)) groupNames.add(name);
    if (filter && !filter.includes(entry.promptId)) continue;
    const key = promptSiteKey(entry);
    multiplicity.set(key, (multiplicity.get(key) ?? 0) + 1);
  }
  return { names, multiplicity };
};

export const createPromptApplyState = (
  content: string,
  prompts: LoadedPrompt[],
  version: string,
  shouldEscapeNonAscii: boolean,
  buildTime?: string,
  patchFilter?: string[] | null,
  pristineContent?: string
): PromptApplyState => {
  const matchSpecs = new Map<string, PromptMatchSpec>();
  for (const entry of prompts) {
    matchSpecs.set(entry.regex, {
      regex: entry.regex,
      pieces: entry.pieces,
      version,
      buildTime,
    });
  }
  const matchCatalog = new PromptPieceMatcherCatalog([...matchSpecs.values()]);
  matchCatalog.index(content, foldPromptMatchContent(content));
  const groups = promptGroups(prompts, patchFilter);
  return {
    version,
    shouldEscapeNonAscii,
    patchFilter,
    pristineContent,
    working: new MutableText(content),
    contentChanged:
      pristineContent !== undefined && pristineContent !== content,
    regions: BundleRegions.of(content),
    pristineRegions:
      pristineContent === undefined ? null : BundleRegions.of(pristineContent),
    matchSpecs,
    matchCatalog,
    expiringMatches: matchExpiryIndexes(prompts),
    pristinePromptIds: sharedPristinePromptIds(prompts),
    groupNames: groups.names,
    groupMultiplicity: groups.multiplicity,
    groupRetained: new Map(),
    groupSpliced: new Map(),
    results: [],
    appliedHashUpdates: {},
    hashResultIndexes: [],
  };
};

export const recordPromptResult = (
  state: PromptApplyState,
  entry: LoadedPrompt,
  fields: Partial<PatchResult>,
  storeHash = false
): void => {
  if (storeHash) {
    state.appliedHashUpdates[entry.promptId] = computeMD5Hash(
      entry.prompt.content
    );
    state.hashResultIndexes.push(state.results.length);
  }
  state.results.push({
    id: entry.promptId,
    name: entry.prompt.name,
    group: PatchGroup.SYSTEM_PROMPTS,
    applied: false,
    ...fields,
  });
};

export const retainPromptSite = (
  state: PromptApplyState,
  entry: LoadedPrompt
): void => {
  const key = promptSiteKey(entry);
  state.groupRetained.set(key, (state.groupRetained.get(key) ?? 0) + 1);
};

export const storePromptApplyHashes = async (
  state: PromptApplyState
): Promise<void> => {
  try {
    await setAppliedHashes(state.appliedHashUpdates);
  } catch (error) {
    debug(`Failed to store applied prompt hashes: ${error}`);
    for (const index of state.hashResultIndexes) {
      const result = state.results[index];
      if (!result) continue;
      result.failed = true;
      result.details = result.details
        ? `${result.details} (hash storage failed)`
        : 'hash storage failed';
    }
  }
};
