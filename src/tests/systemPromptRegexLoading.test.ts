import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as promptSync from '../systemPromptSync';
import type { StringsFile } from '../systemPromptSync';

vi.mock('node:fs/promises');
vi.mock('../systemPromptDownload');

beforeEach(() => {
  vi.clearAllMocks();
});
describe('loadSystemPromptsWithRegex preserves dollar signs', () => {
  it('should correctly handle variable names with double dollar signs ($$)', async () => {
    const mockStringsFile: StringsFile = {
      version: '1.0.0',
      prompts: [
        {
          id: 'test-prompt',
          name: 'Test',
          description: 'Test',
          version: '1.0.0',
          pieces: ['\nUsage: ${', '()} ms'],
          identifiers: [1],
          identifierMap: { '1': 'MAX_TIMEOUT' },
        },
      ],
    };

    const { downloadStringsFile } = await import('../systemPromptDownload');
    vi.mocked(downloadStringsFile).mockResolvedValue(mockStringsFile);

    await promptSync.preloadStringsFile('1.0.0');

    const mockMarkdown = `<!--
name: Test
description: Test
ccVersion: 1.0.0
variables:
  - MAX_TIMEOUT
-->

Usage: \${MAX_TIMEOUT()} ms`;

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockMarkdown);

    const results = await promptSync.loadSystemPromptsWithRegex('1.0.0');
    expect(results).toHaveLength(1);

    const matchResult = ['full match', 'J$$'] as RegExpMatchArray;
    const interpolated = results[0].getInterpolatedContent(matchResult);

    expect(interpolated).toBe('\nUsage: ${J$$()} ms');
    expect(interpolated).not.toBe('\nUsage: ${J$()} ms');
  });
});
describe('loadSystemPromptsWithRegex expands build placeholders', () => {
  it('should correctly handle <<BUILD_TIME>> placeholder', async () => {
    const mockStringsFile: StringsFile = {
      version: '1.0.0',
      prompts: [
        {
          id: 'test-prompt',
          name: 'Test',
          description: 'Test',
          version: '1.0.0',
          pieces: ['\nVersion: <<CCVERSION>>, BUILD_TIME:"<<BUILD_TIME>>"'],
          identifiers: [],
          identifierMap: {},
        },
      ],
    };

    const { downloadStringsFile } = await import('../systemPromptDownload');
    vi.mocked(downloadStringsFile).mockResolvedValue(mockStringsFile);

    await promptSync.preloadStringsFile('1.0.0');

    const mockMarkdown = `<!--
name: Test
description: Test
ccVersion: 1.0.0
-->

Version: <<CCVERSION>>, BUILD_TIME:"<<BUILD_TIME>>"`;

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockMarkdown);

    const buildTime = '2025-12-09T19:43:43Z';
    const results = await promptSync.loadSystemPromptsWithRegex(
      '1.0.0',
      false,
      buildTime
    );
    expect(results).toHaveLength(1);

    const testCliContent =
      '\nVersion: 1.0.0, BUILD_TIME:"2025-12-09T19:43:43Z"';
    const regex = new RegExp(results[0].regex);
    const match = testCliContent.match(regex);

    expect(match).not.toBeNull();

    const matchResult = [
      '\nVersion: 1.0.0, BUILD_TIME:"2025-12-09T19:43:43Z"',
    ] as RegExpMatchArray;
    const interpolated = results[0].getInterpolatedContent(matchResult);

    expect(interpolated).toBe(
      '\nVersion: 1.0.0, BUILD_TIME:"2025-12-09T19:43:43Z"'
    );
  });
});
describe('loadSystemPromptsWithRegex matches newline forms', () => {
  it('should generate regex that matches both actual newlines and literal \\n', async () => {
    const mockStringsFile: StringsFile = {
      version: '1.0.0',
      prompts: [
        {
          id: 'test-prompt',
          name: 'Test',
          description: 'Test',
          version: '1.0.0',
          pieces: ['Hello\nWorld'],
          identifiers: [],
          identifierMap: {},
        },
      ],
    };

    const { downloadStringsFile } = await import('../systemPromptDownload');
    vi.mocked(downloadStringsFile).mockResolvedValue(mockStringsFile);

    await promptSync.preloadStringsFile('1.0.0');

    const mockMarkdown = `<!--
name: Test
description: Test
ccVersion: 1.0.0
-->

Hello
World`;

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockMarkdown);

    const results = await promptSync.loadSystemPromptsWithRegex('1.0.0');
    expect(results).toHaveLength(1);

    const regex = new RegExp(results[0].regex, 'si');

    const templateLiteralContent = 'Hello\nWorld';
    expect(templateLiteralContent.match(regex)).not.toBeNull();

    const stringLiteralContent = 'Hello\\nWorld';
    expect(stringLiteralContent.match(regex)).not.toBeNull();
  });
});
describe('loadSystemPromptsWithRegex skips missing overrides', () => {
  it('skips a catalogued id with no override file without logging', async () => {
    const mockStringsFile: StringsFile = {
      version: '1.0.0',
      prompts: [
        {
          id: 'no-override',
          name: 'Test',
          description: 'Test',
          version: '1.0.0',
          pieces: ['Hello'],
          identifiers: [],
          identifierMap: {},
        },
      ],
    };
    const { downloadStringsFile } = await import('../systemPromptDownload');
    vi.mocked(downloadStringsFile).mockResolvedValue(mockStringsFile);
    await promptSync.preloadStringsFile('1.0.0');

    const enoent = Object.assign(new Error('missing'), { code: 'ENOENT' });
    vi.spyOn(fs, 'readFile').mockRejectedValue(enoent);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const results = await promptSync.loadSystemPromptsWithRegex('1.0.0');
    expect(results).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
