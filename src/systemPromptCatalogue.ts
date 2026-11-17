import { reconstructContentFromPieces } from './systemPromptMarkdown';
import type { loadSystemPromptsWithRegex } from './systemPromptSync';

export type LoadedPrompt = Awaited<
  ReturnType<typeof loadSystemPromptsWithRegex>
>[number];

export const promptBaseline = (entry: LoadedPrompt): string =>
  reconstructContentFromPieces(
    entry.pieces,
    entry.identifiers,
    entry.identifierMap
  ).trim();

export const canonicalPromptEntries = (
  prompts: readonly LoadedPrompt[]
): Set<LoadedPrompt> => {
  const firstBodiesById = new Map<string, string>();
  const canonical = new Set<LoadedPrompt>();
  for (const entry of prompts) {
    const baseline = promptBaseline(entry);
    const firstBody = firstBodiesById.get(entry.promptId) ?? baseline;
    firstBodiesById.set(entry.promptId, firstBody);
    const body = entry.prompt.content.trim();
    if (body === firstBody || body === baseline) canonical.add(entry);
  }
  return canonical;
};
