import { downloadStringsFile } from './systemPromptDownload';
import { computeMD5Hash } from './systemPromptHashIndex';
import { reconstructContentFromPieces } from './systemPromptMarkdown';

export type PromptHistory = (
  id: string,
  version: string,
  content: string
) => Promise<boolean>;

export const createPromptHistory = (): PromptHistory => {
  const versions = new Map<string, Promise<Map<string, Set<string>>>>();
  return async (id, version, content) => {
    let loading = versions.get(version);
    if (!loading) {
      loading = downloadStringsFile(version).then(file => {
        const hashes = new Map<string, Set<string>>();
        for (const prompt of file.prompts) {
          const candidates = hashes.get(prompt.id) ?? new Set<string>();
          candidates.add(
            computeMD5Hash(
              reconstructContentFromPieces(
                prompt.pieces,
                prompt.identifiers,
                prompt.identifierMap
              )
            )
          );
          hashes.set(prompt.id, candidates);
        }
        return hashes;
      });
      versions.set(version, loading);
    }
    try {
      const hashes = await loading;
      return hashes.get(id)?.has(computeMD5Hash(content)) ?? false;
    } catch {
      return false;
    }
  };
};
