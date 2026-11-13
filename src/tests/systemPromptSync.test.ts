import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as promptSync from '../systemPromptSync';
import type { StringsPrompt } from '../systemPromptSync';

vi.mock('node:fs/promises');
vi.mock('../systemPromptDownload');

const createEnoent = () => {
  const error: NodeJS.ErrnoException = new Error(
    'ENOENT: no such file or directory'
  );
  error.code = 'ENOENT';
  return error;
};

beforeEach(() => {
  vi.clearAllMocks();
});
describe('parseMarkdownPrompt', () => {
  it('should parse markdown with frontmatter', () => {
    const markdown = `<!--
name: Test Prompt
description: A test prompt
ccVersion: 1.0.0
variables:
  - SETTINGS
  - CONFIG
-->

This is the content with \${SETTINGS.preferredName} and \${CONFIG.taskType}.`;

    const result = promptSync.parseMarkdownPrompt(markdown);

    expect(result).toEqual({
      name: 'Test Prompt',
      description: 'A test prompt',
      ccVersion: '1.0.0',
      variables: ['SETTINGS', 'CONFIG'],
      content:
        '\nThis is the content with ${SETTINGS.preferredName} and ${CONFIG.taskType}.',
      contentLineOffset: 8,
    });
  });

  it('should handle markdown without variables', () => {
    const markdown = `<!--
name: Simple Prompt
description: No variables
ccVersion: 1.0.0
-->

Simple content.`;

    const result = promptSync.parseMarkdownPrompt(markdown);

    expect(result).toEqual({
      name: 'Simple Prompt',
      description: 'No variables',
      ccVersion: '1.0.0',
      variables: [],
      content: '\nSimple content.',
      contentLineOffset: 5,
    });
  });

  it('should handle missing frontmatter fields', () => {
    const markdown = `<!--
-->

Content only.`;

    const result = promptSync.parseMarkdownPrompt(markdown);

    expect(result).toEqual({
      name: '',
      description: '',
      ccVersion: '',
      variables: [],
      content: '\nContent only.',
      contentLineOffset: 2,
    });
  });
});

describe('reconstructContentFromPieces', () => {
  it('should reconstruct content with placeholders for minified variables', () => {
    const pieces = [
      'You will greet the user as ${',
      '.preferredName}, running on ${',
      '.platform}!',
    ];
    const identifiers = [1, 2];
    const identifierMap = { '1': 'SETTINGS', '2': 'CONFIG' };

    const result = promptSync.reconstructContentFromPieces(
      pieces,
      identifiers,
      identifierMap
    );

    expect(result).toBe(
      'You will greet the user as ${SETTINGS.preferredName}, running on ${CONFIG.platform}!'
    );
  });

  it('should handle empty identifier map', () => {
    const pieces = ['Just text'];
    const identifiers: number[] = [];
    const identifierMap = {};

    const result = promptSync.reconstructContentFromPieces(
      pieces,
      identifiers,
      identifierMap
    );

    expect(result).toBe('Just text');
  });

  it('should handle missing identifier mappings', () => {
    const pieces = ['Start ', ' end'];
    const identifiers = [999];
    const identifierMap = {};

    const result = promptSync.reconstructContentFromPieces(
      pieces,
      identifiers,
      identifierMap
    );

    expect(result).toBe('Start UNKNOWN_999 end');
  });

  it('should handle numeric and string identifiers', () => {
    const pieces = ['Use ${', '.currentMode} and ${', '.theme} together'];
    const identifiers = [1, '2'];
    const identifierMap = { '1': 'STATE', '2': 'CONFIG' };

    const result = promptSync.reconstructContentFromPieces(
      pieces,
      identifiers,
      identifierMap
    );

    expect(result).toBe(
      'Use ${STATE.currentMode} and ${CONFIG.theme} together'
    );
  });
});

describe('generateMarkdownFromPrompt', () => {
  it('should generate markdown with variables', () => {
    const prompt: StringsPrompt = {
      id: 'test-id',
      name: 'Test Prompt',
      description: 'Test description',
      version: '1.0.0',
      pieces: ['You will greet the user as ${', '.preferredName}!'],
      identifiers: [1],
      identifierMap: { '1': 'SETTINGS' },
    };

    const result = promptSync.generateMarkdownFromPrompt(prompt);
    const parsed = promptSync.parseMarkdownPrompt(result);

    expect(parsed.name).toBe(prompt.name);
    expect(parsed.description).toBe(prompt.description);
    expect(parsed.ccVersion).toBe(prompt.version);
    expect(parsed.variables).toEqual(['SETTINGS']);
    expect(parsed.content).toContain(
      'You will greet the user as ${SETTINGS.preferredName}!'
    );
  });

  it('should generate markdown without variables when identifierMap is empty', () => {
    const prompt: StringsPrompt = {
      id: 'test-id',
      name: 'Simple Prompt',
      description: 'No vars',
      version: '1.0.0',
      pieces: ['Plain text'],
      identifiers: [],
      identifierMap: {},
    };

    const result = promptSync.generateMarkdownFromPrompt(prompt);
    const parsed = promptSync.parseMarkdownPrompt(result);

    expect(parsed.name).toBe(prompt.name);
    expect(parsed.variables).toEqual([]);
    expect(parsed.content.trim()).toBe('Plain text');
  });
});
describe('generateMarkdownFromPrompt', () => {
  it('should use custom content when provided', () => {
    const prompt: StringsPrompt = {
      id: 'test-id',
      name: 'Test',
      description: 'Test',
      version: '1.0.0',
      pieces: ['Original'],
      identifiers: [],
      identifierMap: {},
    };

    const result = promptSync.generateMarkdownFromPrompt(
      prompt,
      'Custom content here'
    );

    expect(result).toContain('Custom content here');
    expect(result).not.toContain('Original');
  });

  it('should deduplicate variables in frontmatter', () => {
    const prompt: StringsPrompt = {
      id: 'test-id',
      name: 'Test',
      description: 'Test',
      version: '1.0.0',
      pieces: ['The user name is ${', '.userName} and again ${', '.userName}.'],
      identifiers: [1, 1], // Same identifier used twice
      identifierMap: { '1': 'SETTINGS' },
    };

    const result = promptSync.generateMarkdownFromPrompt(prompt);

    const matches = result.match(/^ {2}- SETTINGS$/gm);
    expect(matches?.length).toBe(1); // Should only appear once in variables list
  });
});
describe('compareVersions', () => {
  it('should return -1 when v1 < v2', () => {
    expect(promptSync.compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(promptSync.compareVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(promptSync.compareVersions('1.9.0', '1.10.0')).toBe(-1);
  });

  it('should return 0 when versions are equal', () => {
    expect(promptSync.compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(promptSync.compareVersions('2.5.7', '2.5.7')).toBe(0);
  });

  it('should return 1 when v1 > v2', () => {
    expect(promptSync.compareVersions('2.0.0', '1.0.0')).toBe(1);
    expect(promptSync.compareVersions('1.2.4', '1.2.3')).toBe(1);
    expect(promptSync.compareVersions('1.10.0', '1.9.0')).toBe(1);
  });

  it('should handle versions with different lengths', () => {
    expect(promptSync.compareVersions('1.0', '1.0.0')).toBe(0);
    expect(promptSync.compareVersions('1.0.1', '1.0')).toBe(1);
    expect(promptSync.compareVersions('1.0', '1.0.1')).toBe(-1);
  });
});

describe('getPromptFilePath', () => {
  it('should return correct file path for prompt', () => {
    const result = promptSync.getPromptFilePath('test-prompt');
    expect(result).toContain('test-prompt.md');
    expect(result).toContain('system-prompts');
  });
});

describe('promptFileExists', () => {
  it('should return true if file exists', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined);

    const result = await promptSync.promptFileExists('test-prompt');

    expect(result).toBe(true);
  });

  it('should return false if file does not exist', async () => {
    vi.spyOn(fs, 'access').mockRejectedValue(createEnoent());

    const result = await promptSync.promptFileExists('test-prompt');

    expect(result).toBe(false);
  });
});

describe('readPromptFile', () => {
  it('should read and parse prompt file', async () => {
    const mockContent = `<!--
name: Test Prompt
description: Test
ccVersion: 1.0.0
-->

Content here`;

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);

    const result = await promptSync.readPromptFile('test-prompt');

    expect(result).toEqual({
      name: 'Test Prompt',
      description: 'Test',
      ccVersion: '1.0.0',
      variables: [],
      content: '\nContent here',
      contentLineOffset: 5,
    });
  });
});

describe('writePromptFile', () => {
  it('should write prompt file', async () => {
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await promptSync.writePromptFile('test-prompt', 'content');

    expect(writeFileSpy).toHaveBeenCalled();
    const [filePath, content] = writeFileSpy.mock.calls[0];
    expect(filePath).toContain('test-prompt.md');
    expect(content).toBe('content');
  });
});

describe('updateVariables', () => {
  it('should update variables in frontmatter', async () => {
    const mockContent = `<!--
name: Test
description: Test
ccVersion: 1.0.0
variables:
  - OLD_VAR
-->

Content`;

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const newIdentifierMap = { '1': 'SETTINGS', '2': 'CONFIG' };
    await promptSync.updateVariables('test-prompt', newIdentifierMap);

    expect(writeFileSpy).toHaveBeenCalled();
    const writtenContent = writeFileSpy.mock.calls[0][1] as string;
    expect(writtenContent).toContain('SETTINGS');
    expect(writtenContent).toContain('CONFIG');
    expect(writtenContent).not.toContain('OLD_VAR');
  });

  it('should remove variables field when identifierMap is empty', async () => {
    const mockContent = `<!--
name: Test
description: Test
ccVersion: 1.0.0
variables:
  - OLD_VAR
-->

Content`;

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await promptSync.updateVariables('test-prompt', {});

    expect(writeFileSpy).toHaveBeenCalled();
    const writtenContent = writeFileSpy.mock.calls[0][1] as string;
    expect(writtenContent).not.toContain('variables:');
    expect(writtenContent).not.toContain('OLD_VAR');
  });

  it('should skip writing when variables are already current', async () => {
    const prompt: StringsPrompt = {
      id: 'test-prompt',
      name: 'Test',
      description: 'Test',
      ccVersion: '1.0.0',
      version: '1.0.0',
      pieces: ['Content ${', '}'],
      identifiers: [1],
      identifierMap: { '1': 'SETTINGS' },
    } as StringsPrompt;
    const mockContent = promptSync.generateMarkdownFromPrompt(prompt);

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await promptSync.updateVariables('test-prompt', { '1': 'SETTINGS' });

    expect(writeFileSpy).not.toHaveBeenCalled();
  });
});
