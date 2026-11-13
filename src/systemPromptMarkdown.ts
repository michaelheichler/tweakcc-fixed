import * as fs from 'node:fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import { SYSTEM_PROMPTS_DIR } from './config';

export interface StringsPrompt {
  name: string;
  id: string;
  description: string;
  pieces: string[];
  identifiers: number[];
  identifierMap: Record<string, string>;
  version: string;
  occurrences?: number;
  platforms?: string[];
  asset?: string;
}

export interface StringsFile {
  version: string;
  prompts: StringsPrompt[];
}

export interface MarkdownPrompt {
  name: string;
  description: string;
  ccVersion: string;
  variables?: string[];
  content: string;
  contentLineOffset: number;
}

export interface SyncResult {
  id: string;
  name: string;
  description: string;
  action: 'created' | 'updated' | 'skipped' | 'conflict';
  oldVersion?: string;
  newVersion: string;
  diffHtmlPath?: string;
}

export interface SyncSummary {
  ccVersion: string;
  results: SyncResult[];
}

export const parseMarkdownPrompt = (markdown: string): MarkdownPrompt => {
  const parsed = matter(markdown, {
    delimiters: ['<!--', '-->'],
  });
  const { name, description, ccVersion, variables } = parsed.data;
  let contentLineOffset = 0;
  const contentIndex = markdown.indexOf(parsed.content);
  if (contentIndex >= 0) {
    const prefix = markdown.slice(0, contentIndex);
    contentLineOffset = prefix.split('\n').length - 1;
  }
  return {
    name: name || '',
    description: description || '',
    ccVersion: ccVersion || '',
    variables: variables || [],
    content: parsed.content,
    contentLineOffset,
  };
};

export const stringifyPromptMarkdown = (
  content: string,
  frontmatterData: Record<string, unknown>
): string => {
  const header = matter
    .stringify('', frontmatterData, { delimiters: ['<!--', '-->'] })
    .replace(/\n$/, '')
    .split('\n');
  for (const [key, value] of Object.entries(frontmatterData)) {
    if (typeof value !== 'string') continue;
    const start = header.findIndex(line => line.startsWith(`${key}:`));
    if (start < 0) continue;
    let end = start + 1;
    while (
      end < header.length &&
      (header[end] === '' || /^\s/.test(header[end]))
    ) {
      end++;
    }
    header.splice(start, end - start, `${key}: ${JSON.stringify(value)}`);
  }
  return (
    header.join('\n') + (content.endsWith('\n') ? content : content + '\n')
  );
};

export const generateMarkdownFromPrompt = (
  prompt: StringsPrompt,
  customContent?: string,
  extraFrontmatter?: Record<string, unknown>
): string => {
  const content =
    customContent ??
    reconstructContentFromPieces(
      prompt.pieces,
      prompt.identifiers,
      prompt.identifierMap
    );
  const variables =
    Object.keys(prompt.identifierMap).length > 0
      ? [...new Set(Object.values(prompt.identifierMap))]
      : undefined;
  const frontmatterData: Record<string, unknown> = {
    name: prompt.name,
    description: prompt.description,
    ccVersion: prompt.version,
  };
  if (variables && variables.length > 0) {
    frontmatterData.variables = variables;
  }
  if (extraFrontmatter) {
    for (const [k, v] of Object.entries(extraFrontmatter)) {
      if (k in frontmatterData) continue;
      frontmatterData[k] = v;
    }
  }
  return stringifyPromptMarkdown(content, frontmatterData);
};

const readCustomFrontmatter = async (
  promptId: string
): Promise<Record<string, unknown>> => {
  const out: Record<string, unknown> = {};
  try {
    const filePath = getPromptFilePath(promptId);
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = matter(text, { delimiters: ['<!--', '-->'] });
    const canonical = new Set([
      'name',
      'description',
      'ccVersion',
      'variables',
    ]);
    for (const [k, v] of Object.entries(parsed.data)) {
      if (!canonical.has(k)) out[k] = v;
    }
  } catch {
    return out;
  }
  return out;
};

export const reconstructContentFromPieces = (
  pieces: string[],
  identifiers: (number | string)[],
  identifierMap: Record<string, string>
): string => {
  let result = '';
  for (let i = 0; i < pieces.length; i++) {
    result += pieces[i];
    if (i < identifiers.length) {
      const labelIndex = identifiers[i];
      const humanName =
        identifierMap[String(labelIndex)] || `UNKNOWN_${labelIndex}`;
      result += humanName;
    }
  }
  return result;
};

export const getPromptFilePath = (promptId: string): string => {
  return path.join(SYSTEM_PROMPTS_DIR, `${promptId}.md`);
};

export const promptFileExists = async (promptId: string): Promise<boolean> => {
  try {
    await fs.access(getPromptFilePath(promptId));
    return true;
  } catch {
    return false;
  }
};

export const readPromptFile = async (
  promptId: string
): Promise<MarkdownPrompt> => {
  const filePath = getPromptFilePath(promptId);
  const content = await fs.readFile(filePath, 'utf-8');
  return parseMarkdownPrompt(content);
};

export const writePromptFile = async (
  promptId: string,
  content: string
): Promise<void> => {
  const filePath = getPromptFilePath(promptId);
  await fs.writeFile(filePath, content, 'utf-8');
};

export const updateVariables = async (
  promptId: string,
  newIdentifierMap: Record<string, string>
): Promise<void> => {
  const filePath = getPromptFilePath(promptId);
  const markdown = await fs.readFile(filePath, 'utf-8');
  const parsed = matter(markdown, {
    delimiters: ['<!--', '-->'],
  });
  const variables =
    Object.keys(newIdentifierMap).length > 0
      ? [...new Set(Object.values(newIdentifierMap))]
      : undefined;
  const canonicalKeys = new Set([
    'name',
    'description',
    'ccVersion',
    'variables',
  ]);
  const updatedData: Record<string, unknown> = {
    name: parsed.data.name,
    description: parsed.data.description,
    ccVersion: parsed.data.ccVersion,
  };
  if (variables && variables.length > 0) {
    updatedData.variables = variables;
  }
  for (const [k, v] of Object.entries(parsed.data)) {
    if (!canonicalKeys.has(k)) updatedData[k] = v;
  }
  const updatedMarkdown = stringifyPromptMarkdown(parsed.content, updatedData);
  if (updatedMarkdown === markdown) return;
  await writePromptFile(promptId, updatedMarkdown);
};
export { readCustomFrontmatter };
