import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  clearShadowSetCache,
  loadSystemPromptsWithRegex,
  preloadStringsFile,
} from '../systemPromptSync';
import { downloadStringsFile } from '../systemPromptDownload';
import type { StringsFile } from '../systemPromptMarkdown';

vi.mock('node:fs/promises');
vi.mock('../systemPromptDownload');

describe('asset prompt loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearShadowSetCache();
  });

  it('preserves the text asset path for each configured occurrence', async () => {
    const stringsFile: StringsFile = {
      version: '2.1.322',
      prompts: [
        {
          id: 'model-help',
          name: 'Model help',
          description: 'A help document.',
          version: '2.1.322',
          pieces: ['Choose a model.'],
          identifiers: [],
          identifierMap: {},
          occurrences: 2,
          asset: '/$bunfs/root/model-help.md',
        },
      ],
    };
    vi.mocked(downloadStringsFile).mockResolvedValue(stringsFile);
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.readFile).mockResolvedValue(
      '<!--\nname: Model help\ndescription: A help document.\nccVersion: 2.1.322\n-->\n\nChoose a model.'
    );
    await preloadStringsFile(stringsFile.version);

    const prompts = await loadSystemPromptsWithRegex(stringsFile.version);

    expect(prompts).toHaveLength(2);
    expect(prompts.map(prompt => prompt.asset)).toEqual([
      '/$bunfs/root/model-help.md',
      '/$bunfs/root/model-help.md',
    ]);
  });
});
