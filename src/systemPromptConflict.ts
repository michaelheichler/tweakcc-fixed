import chalk from 'chalk';
import { downloadStringsFile } from './systemPromptDownload';
import { generateDiffHtml } from './systemPromptDiff';
import {
  StringsPrompt,
  MarkdownPrompt,
  reconstructContentFromPieces,
  getPromptFilePath,
} from './systemPromptMarkdown';

export const createPromptConflictDiff = async (
  prompt: StringsPrompt,
  existingFile: MarkdownPrompt
): Promise<string> => {
  let oldBaselineContent = existingFile.content;
  try {
    const oldStringsFile = await downloadStringsFile(existingFile.ccVersion);
    const oldPrompt = oldStringsFile.prompts.find(p => p.id === prompt.id);
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
  return diffPath;
};
