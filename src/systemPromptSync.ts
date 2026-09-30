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
  getPromptFilePath,
  readCustomFrontmatter,
  SyncSummary,
  StringsFile,
  MarkdownPrompt,
  parseMarkdownPrompt,
} from './systemPromptMarkdown';
import { generateDiffHtml } from './systemPromptDiff';
import { buildSearchRegexFromPieces } from './systemPromptRegex';
import { applyIdentifierMapping } from './systemPromptIdentifiers';

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
  prompt: StringsPrompt
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
  await updateVariables(prompt.id, prompt.identifierMap);
  if (existingFile.ccVersion && prompt.version) {
    const versionComparison = compareVersions(
      existingFile.ccVersion,
      prompt.version
    );
    if (versionComparison === 0) {
      result.action = 'skipped';
      return result;
    }
    if (versionComparison != 0) {
      const oldHash = await getPromptHash(prompt.id, existingFile.ccVersion);
      const currentHash = computeMD5Hash(existingFile.content);
      const isModified = !oldHash || oldHash !== currentHash;
      if (isModified) {
        result.action = 'conflict';
        let oldBaselineContent = existingFile.content;
        try {
          const oldStringsFile = await downloadStringsFile(
            existingFile.ccVersion
          );
          const oldPrompt = oldStringsFile.prompts.find(
            p => p.id === prompt.id
          );
          if (oldPrompt) {
            oldBaselineContent = reconstructContentFromPieces(
              oldPrompt.pieces,
              oldPrompt.identifiers,
              oldPrompt.identifierMap
            );
          }
        } catch {
          console.log(
            chalk.yellow(
              `Warning: Could not fetch old version ${existingFile.ccVersion} for comparison. Using current file as baseline.`
            )
          );
        }
        const newBaselineContent = reconstructContentFromPieces(
          prompt.pieces,
          prompt.identifiers,
          prompt.identifierMap
        );
        const markdownFilePath = getPromptFilePath(prompt.id);
        const diffPath = await generateDiffHtml(
          prompt.id,
          prompt.name,
          oldBaselineContent,
          existingFile.content,
          newBaselineContent,
          existingFile.ccVersion,
          prompt.version,
          markdownFilePath
        );
        result.diffHtmlPath = diffPath;
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
  for (const prompt of stringsFile.prompts) {
    try {
      const result = await syncPrompt(prompt);
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
      });
    }
  }
  return results;
};

export const displaySyncResults = (summary: SyncSummary): void => {
  const created = summary.results.filter(r => r.action === 'created');
  const updated = summary.results.filter(r => r.action === 'updated');
  const conflicts = summary.results.filter(r => r.action === 'conflict');
  const skipped = summary.results.filter(r => r.action === 'skipped');
  if (
    (created.length > 0 || updated.length > 0 || conflicts.length > 0) &&
    skipped.length > 0
  ) {
    console.log(chalk.dim(`Skipped ${skipped.length} up-to-date file(s)`));
    console.log();
  }
  if (created.length > 0) {
    console.log(
      chalk.bold.green(`Created ${created.length} new prompt file(s):`)
    );
    for (const result of created) {
      console.log(chalk.green(`  ${SYSTEM_PROMPTS_DIR}/${result.id}.md`));
      console.log(chalk.green.dim(`    ${result.description}`));
    }
    console.log();
  }
  if (updated.length > 0) {
    console.log(
      chalk.bold.blue(`Updated ${updated.length} system prompt file(s):`)
    );
    for (const result of updated) {
      if (result.oldVersion) {
        console.log(
          chalk.blue(
            `  ${result.id}.md  (${result.oldVersion} → ${result.newVersion})`
          )
        );
      } else {
        console.log(chalk.blue(`  ${result.id}.md  (→ ${result.newVersion})`));
      }
    }
    console.log();
  }
  if (conflicts.length > 0) {
    console.log(
      chalk.bold.yellow(
        `WARNING: Conflicts detected for ${conflicts.length} system prompt file(s)`
      )
    );
    for (const result of conflicts) {
      console.log(
        chalk.yellow(
          ` ${result.id}.md (${result.oldVersion} → ${result.newVersion})`
        )
      );
      console.log(
        chalk.yellow(`   Open the diff in your browser: ${result.diffHtmlPath}`)
      );
    }
    console.log();
  }
  if (created.length > 0) {
    console.log(
      chalk.green.bold(
        `New prompt files have been created; either more are now supported by tweakcc or Anthropic has added new ones.`
      )
    );
    console.log(
      chalk.green(
        `You can now customize the markdown files at ${SYSTEM_PROMPTS_DIR} in a text editor.`
      )
    );
    console.log(
      chalk.green(
        `Then run tweakcc and select "apply" or use tweakcc --apply to update your system prompts`
      )
    );
    console.log();
  }
  if (conflicts.length > 0) {
    console.log();
    console.log(`Review conflicts:`);
    console.log(`  1. Open the diff HTML files in your browser`);
    console.log(`  2. Verify your customizations are still appropriate`);
    console.log(`  3. Update your markdown files if needed`);
    console.log(
      chalk.bold.cyan(
        `  4. Important: Update the ccVersion in your markdown files to the latest version of each prompt:`
      )
    );
    for (const result of conflicts) {
      console.log(
        chalk.yellow(`      ${result.id}.md → `) +
          chalk.bold.magenta(result.newVersion)
      );
    }
    console.log(`  5. Delete the diff HTML files`);
    console.log();
  }
};
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
