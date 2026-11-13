import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as promptSync from '../systemPromptSync';
import type { StringsPrompt, StringsFile } from '../systemPromptSync';

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
describe('generateDiffHtml', () => {
  it('should generate HTML diff file with two side-by-side diffs', async () => {
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const htmlPath = await promptSync.generateDiffHtml(
      'test-prompt',
      'Test Prompt',
      'Old baseline\nLine 2',
      'User customization\nLine 2',
      'New baseline\nLine 2',
      '1.0.0',
      '2.0.0',
      '/path/to/test-prompt.md'
    );

    expect(writeFileSpy).toHaveBeenCalled();
    expect(htmlPath).toContain('test-prompt.diff.html');

    const htmlContent = writeFileSpy.mock.calls[0][1] as string;
    expect(htmlContent).toContain('<!DOCTYPE html>');
    expect(htmlContent).toContain('test-prompt');
    expect(htmlContent).toContain('1.0.0');
    expect(htmlContent).toContain('2.0.0');
    expect(htmlContent).toContain('Your Customizations');
    expect(htmlContent).toContain('Upstream Changes');
  });

  it('should escape HTML in content', async () => {
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await promptSync.generateDiffHtml(
      'test',
      'Test',
      '<script>alert("xss")</script>',
      '<script>alert("xss")</script>',
      'Safe & sound',
      '1.0.0',
      '2.0.0',
      '/path/to/test.md'
    );

    const htmlContent = (
      fs.writeFile as typeof fs.writeFile & {
        mock: { calls: [string, string][] };
      }
    ).mock.calls[0][1] as string;
    expect(htmlContent).not.toContain('<script>');
    expect(htmlContent).toContain('&lt;script&gt;');
    expect(htmlContent).toContain('&amp;');
  });
});

const mockPrompt: StringsPrompt = {
  id: 'test-id',
  name: 'test-prompt',
  description: 'Test prompt',
  version: '2.0.0',
  pieces: ['Greet user as ${', '.preferredName}!'],
  identifiers: [1],
  identifierMap: { '1': 'SETTINGS' },
};
describe('syncPrompt creates a file', () => {
  it('should create new file if it does not exist', async () => {
    vi.spyOn(fs, 'access').mockRejectedValue(createEnoent());
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const result = await promptSync.syncPrompt(mockPrompt);

    expect(result.action).toBe('created');
    expect(result.newVersion).toBe('2.0.0');
    expect(writeFileSpy).toHaveBeenCalled();
  });
});
describe('syncPrompt skips a current version', () => {
  it('should skip if versions match', async () => {
    const mockContent = `<!--
name: test-prompt
description: Test prompt
ccVersion: 2.0.0
-->

Greet user as \${SETTINGS.preferredName}!`;

    vi.spyOn(fs, 'access').mockResolvedValue(undefined);
    vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const result = await promptSync.syncPrompt(mockPrompt);

    expect(result.action).toBe('skipped');
    expect(result.oldVersion).toBe('2.0.0');
    expect(result.newVersion).toBe('2.0.0');
  });
});
describe('syncPrompt reports changed content as a conflict', () => {
  it('should warn about version mismatch when user version is older', async () => {
    const mockContent = `<!--
name: test-prompt
description: Test prompt
ccVersion: 1.0.0
-->

Greet user as \${SETTINGS.preferredName}!`;

    const mockOldStringsFile = {
      version: '1.0.0',
      prompts: [
        {
          id: 'test-prompt',
          name: 'test-prompt',
          description: 'Test prompt',
          pieces: ['Greet user as ', '!'],
          identifiers: [1],
          identifierMap: { '1': 'SETTINGS.preferredName' },
          version: '1.0.0',
        },
      ],
    };

    const { downloadStringsFile } = await import('../systemPromptDownload');
    const hashIndexModule = await import('../systemPromptHashIndex');

    vi.mocked(downloadStringsFile).mockResolvedValue(
      mockOldStringsFile as StringsFile
    );
    vi.spyOn(hashIndexModule, 'getPromptHash').mockResolvedValue(
      'different-hash'
    ); // Simulate user modification

    vi.spyOn(fs, 'access').mockResolvedValue(undefined);
    vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const result = await promptSync.syncPrompt(mockPrompt);

    expect(result.action).toBe('conflict');
    expect(result.oldVersion).toBe('1.0.0');
    expect(result.newVersion).toBe('2.0.0');
    expect(result.diffHtmlPath).toBeDefined();
  });
});
describe('syncPrompt updates the variable list', () => {
  it('should always update variables list', async () => {
    const mockContent = `<!--
name: test-prompt
description: Test prompt
ccVersion: 2.0.0
variables:
  - OLD_VAR
-->

Greet user as \${SETTINGS.preferredName}!`;

    vi.spyOn(fs, 'access').mockResolvedValue(undefined);
    vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await promptSync.syncPrompt(mockPrompt);

    expect(writeFileSpy).toHaveBeenCalled();
  });
});
describe('syncSystemPrompts syncs every prompt', () => {
  it('should sync all prompts from strings file', async () => {
    const mockStringsFile: StringsFile = {
      version: '2.0.0',
      prompts: [
        {
          id: 'prompt1',
          name: 'Prompt 1',
          description: 'First prompt',
          version: '2.0.0',
          pieces: ['Content 1'],
          identifiers: [],
          identifierMap: {},
        },
        {
          id: 'prompt2',
          name: 'Prompt 2',
          description: 'Second prompt',
          version: '2.0.0',
          pieces: ['Content 2'],
          identifiers: [],
          identifierMap: {},
        },
      ],
    };

    const { downloadStringsFile } = await import('../systemPromptDownload');
    const hashIndexModule = await import('../systemPromptHashIndex');

    vi.mocked(downloadStringsFile).mockResolvedValue(
      mockStringsFile as StringsFile
    );
    vi.spyOn(hashIndexModule, 'storeHashes').mockResolvedValue(0);

    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'access').mockRejectedValue(createEnoent());
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const result = await promptSync.syncSystemPrompts('2.0.0');

    expect(result.ccVersion).toBe('2.0.0');
    expect(result.results).toHaveLength(2);
    expect(result.results[0].action).toBe('created');
    expect(result.results[1].action).toBe('created');
  });
});
describe('syncSystemPrompts reports failed prompt syncs', () => {
  it('should throw error for failed prompt syncs', async () => {
    const mockStringsFile: StringsFile = {
      version: '2.0.0',
      prompts: [
        {
          id: 'prompt1',
          name: 'Prompt 1',
          description: 'First prompt',
          version: '2.0.0',
          pieces: ['Content'],
          identifiers: [],
          identifierMap: {},
        },
      ],
    };

    const { downloadStringsFile } = await import('../systemPromptDownload');
    vi.mocked(downloadStringsFile).mockResolvedValue(
      mockStringsFile as StringsFile
    );

    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'access').mockResolvedValue(undefined);
    vi.spyOn(fs, 'readFile').mockRejectedValue(new Error('Permission denied'));

    const errorSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const summary = await promptSync.syncSystemPrompts('2.0.0');
    expect(summary.results).toEqual([]);
    expect(
      errorSpy.mock.calls.some(c => String(c[0]).includes('Permission denied'))
    ).toBe(true);
    errorSpy.mockRestore();
  });
});
describe('syncSystemPrompts reports download errors', () => {
  it('should throw error if download fails', async () => {
    const { downloadStringsFile } = await import('../systemPromptDownload');
    vi.mocked(downloadStringsFile).mockRejectedValue(
      new Error('Download failed')
    );

    await expect(promptSync.syncSystemPrompts('2.0.0')).rejects.toThrow(
      'Download failed'
    );
  });
});
describe('displaySyncResults', () => {
  it('should display sync results without errors', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const summary = {
      ccVersion: '2.0.0',
      results: [
        {
          id: 'prompt1',
          name: 'Prompt 1',
          description: 'Test prompt 1',
          action: 'created' as const,
          newVersion: '2.0.0',
        },
        {
          id: 'prompt2',
          name: 'Prompt 2',
          description: 'Test prompt 2',
          action: 'skipped' as const,
          oldVersion: '2.0.0',
          newVersion: '2.0.0',
        },
      ],
    };

    promptSync.displaySyncResults(summary);

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
    expect(output).toContain('Skipped 1 up-to-date file');
    expect(output).toContain('Created 1 new prompt file');
  });

  it('should display conflicts', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const summary = {
      ccVersion: '2.0.0',
      results: [
        {
          id: 'prompt1',
          name: 'Prompt 1',
          description: 'Test prompt',
          action: 'conflict' as const,
          oldVersion: '1.0.0',
          newVersion: '2.0.0',
          diffHtmlPath: '/path/to/diff.html',
        },
      ],
    };

    promptSync.displaySyncResults(summary);

    const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
    expect(output).toContain('Conflicts detected');
    expect(output).toContain('1.0.0');
    expect(output).toContain('2.0.0');
    expect(output).toContain('diff.html');
  });
});
