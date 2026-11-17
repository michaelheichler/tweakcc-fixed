import * as fs from 'node:fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import { downloadStringsFile } from './systemPromptDownload';
import { compareVersions } from './versionCompare';
import {
  storeHashes,
  getPromptHash,
  computeMD5Hash,
} from './systemPromptHashIndex';
import chalk from 'chalk';
import { SYSTEM_PROMPTS_DIR, SYSTEM_REMINDERS_DIR } from './config';
import { REMINDER_REGISTRY } from './patches/systemReminderOverrides';
import {
  StringsPrompt,
  SyncResult,
  promptFileExists,
  generateMarkdownFromPrompt,
  writePromptFile,
  readPromptFile,
  updateVariables,
  reconstructContentFromPieces,
  readCustomFrontmatter,
  SyncSummary,
  StringsFile,
  MarkdownPrompt,
  parseMarkdownPrompt,
} from './systemPromptMarkdown';
import { createPromptConflictDiff } from './systemPromptConflict';
import { buildSearchRegexFromPieces } from './systemPromptRegex';
import { applyIdentifierMapping } from './systemPromptIdentifiers';
import { createPromptHistory, type PromptHistory } from './systemPromptHistory';

export { compareVersions };

let shadowSetCache: Set<string> | null = null;

export const loadShadowSet = async (): Promise<Set<string>> => {
  if (shadowSetCache) return shadowSetCache;
  const set = new Set<string>();
  const dirs = [SYSTEM_PROMPTS_DIR, SYSTEM_REMINDERS_DIR];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    if (!Array.isArray(files)) continue;
    for (const name of files) {
      if (!name.endsWith('.md')) continue;
      let text: string;
      try {
        text = await fs.readFile(path.join(dir, name), 'utf8');
      } catch {
        continue;
      }
      const parsed = matter(text, {
        delimiters: ['<!--', '-->'],
      });
      const shadows = parsed.data?.shadows;
      if (Array.isArray(shadows)) {
        for (const id of shadows) {
          if (typeof id === 'string' && id) set.add(id);
        }
      }
    }
  }
  for (const injection of REMINDER_REGISTRY) {
    if (Array.isArray(injection.shadows)) {
      for (const id of injection.shadows) {
        if (typeof id === 'string' && id) set.add(id);
      }
    }
  }
  shadowSetCache = set;
  return set;
};

export const clearShadowSetCache = (): void => {
  shadowSetCache = null;
};

export const syncPrompt = async (
  prompt: StringsPrompt,
  history: PromptHistory = createPromptHistory()
): Promise<SyncResult> => {
  const result: SyncResult = {
    id: prompt.id,
    name: prompt.name,
    description: prompt.description,
    action: 'skipped',
    newVersion: prompt.version,
  };
  const shadowSet = await loadShadowSet();
  if (shadowSet.has(prompt.id)) {
    result.action = 'skipped';
    return result;
  }
  const fileExists = await promptFileExists(prompt.id);
  if (!fileExists) {
    if (!prompt.name) {
      result.action = 'skipped';
      return result;
    }
    const markdown = generateMarkdownFromPrompt(prompt);
    await writePromptFile(prompt.id, markdown);
    result.action = 'created';
    return result;
  }
  const existingFile = await readPromptFile(prompt.id);
  result.oldVersion = existingFile.ccVersion;
  if (existingFile.ccVersion && prompt.version) {
    const versionComparison = compareVersions(
      existingFile.ccVersion,
      prompt.version
    );
    if (versionComparison === 0) {
      await updateVariables(prompt.id, prompt.identifierMap);
      result.action = 'skipped';
      return result;
    }
    if (versionComparison != 0) {
      const oldHash = await getPromptHash(prompt.id, existingFile.ccVersion);
      const currentHash = computeMD5Hash(existingFile.content);
      const unmodified = oldHash
        ? oldHash === currentHash
        : await history(
            prompt.id,
            existingFile.ccVersion,
            existingFile.content
          );
      const isModified = !unmodified;
      if (isModified) {
        result.action = 'conflict';
        result.diffHtmlPath = await createPromptConflictDiff(
          prompt,
          existingFile
        );
      } else {
        const customFm = await readCustomFrontmatter(prompt.id);
        const newMarkdown = generateMarkdownFromPrompt(
          prompt,
          undefined,
          customFm
        );
        await writePromptFile(prompt.id, newMarkdown);
        result.action = 'updated';
      }
    }
  }
  return result;
};

export const syncSystemPrompts = async (
  ccVersion: string
): Promise<SyncSummary> => {
  const summary: SyncSummary = {
    ccVersion,
    results: [],
  };
  const stringsFile = await downloadStringsFile(ccVersion);
  await storeHashes(stringsFile);
  await fs.mkdir(SYSTEM_PROMPTS_DIR, { recursive: true });
  const history = createPromptHistory();
  for (const prompt of stringsFile.prompts) {
    try {
      const result = await syncPrompt(prompt, history);
      summary.results.push(result);
    } catch (error) {
      console.log(
        chalk.red(
          `Failed to sync prompt ${prompt.id}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }
  return summary;
};

let globalStringsFile: StringsFile | null = null;

let globalCachedVersion: string | null = null;

export const preloadStringsFile = async (
  version: string
): Promise<{
  success: boolean;
  errorMessage?: string;
}> => {
  try {
    const stringsFile = await downloadStringsFile(version);
    globalStringsFile = stringsFile;
    globalCachedVersion = version;
    return { success: true };
  } catch (error) {
    globalStringsFile = null;
    globalCachedVersion = null;
    if (error instanceof Error) {
      return { success: false, errorMessage: error.message };
    }
    return {
      success: false,
      errorMessage: 'Unknown error occurred while downloading system prompts',
    };
  }
};

export const pristineBodiesById = async (
  version: string
): Promise<Map<string, Set<string>>> => {
  const file =
    globalStringsFile && globalCachedVersion === version
      ? globalStringsFile
      : await downloadStringsFile(version);
  const out = new Map<string, Set<string>>();
  for (const prompt of file.prompts) {
    if (!prompt.id) continue;
    let bodies = out.get(prompt.id);
    if (!bodies) {
      bodies = new Set<string>();
      out.set(prompt.id, bodies);
    }
    bodies.add(
      reconstructContentFromPieces(
        prompt.pieces,
        prompt.identifiers,
        prompt.identifierMap
      )
    );
  }
  return out;
};

export interface SystemPromptDefinition {
  id: string;
  name: string;
  description: string;
}

export const getSystemPromptDefinitions = ():
  | SystemPromptDefinition[]
  | null => {
  if (!globalStringsFile) {
    return null;
  }
  return globalStringsFile.prompts.map(prompt => ({
    id: prompt.id,
    name: prompt.name,
    description: prompt.description,
  }));
};

export const loadSystemPromptsWithRegex = async (
  ccVersion: string,
  ...interpolationOptions: [escapeNonAscii?: boolean, buildTime?: string]
): Promise<
  Array<{
    promptId: string;
    prompt: MarkdownPrompt;
    regex: string;
    getInterpolatedContent: (match: RegExpMatchArray) => string;
    pieces: string[];
    identifiers: (number | string)[];
    identifierMap: Record<string, string>;
    platforms?: string[];
    asset?: string;
  }>
> => {
  const buildTime = interpolationOptions[1];
  if (!globalStringsFile || globalCachedVersion !== ccVersion) {
    return [];
  }
  const stringsJson: StringsFile = globalStringsFile;
  const results: Array<{
    promptId: string;
    prompt: MarkdownPrompt;
    regex: string;
    getInterpolatedContent: (match: RegExpMatchArray) => string;
    pieces: string[];
    identifiers: (number | string)[];
    identifierMap: Record<string, string>;
    platforms?: string[];
    asset?: string;
  }> = [];
  const shadowSet = await loadShadowSet();
  for (const jsonPrompt of stringsJson.prompts) {
    if (!jsonPrompt.id) continue;
    if (shadowSet.has(jsonPrompt.id)) continue;
    const regex = buildSearchRegexFromPieces(
      jsonPrompt.pieces,
      ccVersion,
      buildTime
    );
    const mdPath = path.join(SYSTEM_PROMPTS_DIR, `${jsonPrompt.id}.md`);
    let markdown;
    try {
      markdown = await fs.readFile(mdPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Failed to read markdown file ${mdPath}:`, error);
      }
      continue;
    }
    const replacementPrompt = parseMarkdownPrompt(markdown);
    const getInterpolatedContent = (match: RegExpMatchArray): string => {
      const extractedVars = match.slice(1);
      return applyIdentifierMapping(
        replacementPrompt.content,
        jsonPrompt.identifiers,
        jsonPrompt.identifierMap,
        extractedVars,
        ccVersion,
        false,
        buildTime,
        jsonPrompt.pieces
      );
    };
    const occurrences = jsonPrompt.occurrences ?? 1;
    for (let index = 0; index < occurrences; index++) {
      results.push({
        promptId: jsonPrompt.id,
        prompt: replacementPrompt,
        regex,
        getInterpolatedContent,
        pieces: jsonPrompt.pieces,
        identifiers: jsonPrompt.identifiers,
        identifierMap: jsonPrompt.identifierMap,
        platforms: jsonPrompt.platforms,
        asset: jsonPrompt.asset,
      });
    }
  }
  return results;
};

export { displaySyncResults } from './systemPromptDisplay';
export { shadowSetCache, globalStringsFile, globalCachedVersion };
export type { StringsPrompt } from './systemPromptMarkdown';
export type { StringsFile } from './systemPromptMarkdown';
export type { MarkdownPrompt } from './systemPromptMarkdown';
export type { SyncResult } from './systemPromptMarkdown';
export type { SyncSummary } from './systemPromptMarkdown';
export { parseMarkdownPrompt } from './systemPromptMarkdown';
export { stringifyPromptMarkdown } from './systemPromptMarkdown';
export { generateMarkdownFromPrompt } from './systemPromptMarkdown';
export { reconstructContentFromPieces } from './systemPromptMarkdown';
export { getPromptFilePath } from './systemPromptMarkdown';
export { promptFileExists } from './systemPromptMarkdown';
export { readPromptFile } from './systemPromptMarkdown';
export { writePromptFile } from './systemPromptMarkdown';
export { updateVariables } from './systemPromptMarkdown';
export { generateDiffHtml } from './systemPromptDiff';
export { escapeNonAsciiChars } from './systemPromptRegex';
export { buildSearchRegexFromPieces } from './systemPromptRegex';
export { escapeDepthZeroBackticks } from './systemPromptEscaping';
export type { EncodedReplacement } from './systemPromptEscaping';
export { needsDelimiterAwareEscaping } from './systemPromptEscaping';
export { encodeReplacementForDelimiter } from './systemPromptEscaping';
export { extractOriginalWhitespace } from './systemPromptEscaping';
export { applyOriginalWhitespace } from './systemPromptEscaping';
export { applyIdentifierMapping } from './systemPromptIdentifiers';
