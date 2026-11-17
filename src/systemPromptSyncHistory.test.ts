import * as fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PROMPTS_DIR } from './config';
import { downloadStringsFile } from './systemPromptDownload';
import { storeHashes, writeHashIndex } from './systemPromptHashIndex';
import {
  clearShadowSetCache,
  readPromptFile,
  syncPrompt,
  syncSystemPrompts,
  type StringsFile,
  type StringsPrompt,
} from './systemPromptSync';

vi.mock('./systemPromptDownload', () => ({ downloadStringsFile: vi.fn() }));
vi.mock('./systemPromptConflict', () => ({
  createPromptConflictDiff: vi.fn().mockResolvedValue('fixture-conflict.html'),
}));
vi.mock('./patches/systemReminderOverrides', () => ({ REMINDER_REGISTRY: [] }));

const OLD_VERSION = '2.1.300';
const NEW_VERSION = '2.1.325';
const OLD_BODY = 'Old stock ${OLD_LABEL}.';
const NEW_BODY = 'New stock ${NEW_LABEL}.';
const CUSTOM_BODY = 'Keep my project decisions and use ${OLD_LABEL}.';

function prompt(
  id = 'history-policy',
  version = NEW_VERSION,
  lead = 'New stock ',
  label = 'NEW_LABEL'
): StringsPrompt {
  return {
    id,
    name: 'History fixture',
    description: 'Historical prompt fixture.',
    version,
    pieces: [lead + '${', '}.'],
    identifiers: [1],
    identifierMap: { '1': label },
  };
}

function oldPrompt(id = 'history-policy', lead = 'Old stock '): StringsPrompt {
  return prompt(id, OLD_VERSION, lead, 'OLD_LABEL');
}

function catalogue(version: string, prompts: StringsPrompt[]): StringsFile {
  return { version, prompts };
}

async function seed(id = 'history-policy', body = OLD_BODY): Promise<string> {
  const markdown = [
    '<!--',
    'name: "History fixture"',
    'description: "Historical prompt fixture."',
    `ccVersion: "${OLD_VERSION}"`,
    'variables:',
    '  - OLD_LABEL',
    'note: "Keep personal metadata"',
    '-->',
    '',
    body,
    '',
  ].join('\n');
  await fs.writeFile(path.join(SYSTEM_PROMPTS_DIR, `${id}.md`), markdown);
  return markdown;
}

function history(prompts = [oldPrompt()]): void {
  vi.mocked(downloadStringsFile).mockResolvedValue(
    catalogue(OLD_VERSION, prompts)
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearShadowSetCache();
  await fs.mkdir(SYSTEM_PROMPTS_DIR, { recursive: true });
  await writeHashIndex({});
});

afterEach(async () => {
  await fs.rm(SYSTEM_PROMPTS_DIR, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
});

describe('missing historical prompt hashes', () => {
  it('updates exact historical stock text from its declared catalogue version', async () => {
    await seed();
    history();

    const result = await syncPrompt(prompt());
    const updated = await readPromptFile('history-policy');
    const raw = await fs.readFile(
      path.join(SYSTEM_PROMPTS_DIR, 'history-policy.md'),
      'utf8'
    );

    expect(result.action).toBe('updated');
    expect(updated.content.trim()).toBe(NEW_BODY);
    expect(updated.ccVersion).toBe(NEW_VERSION);
    expect(updated.variables).toEqual(['NEW_LABEL']);
    expect(matter(raw, { delimiters: ['<!--', '-->'] }).data.note).toBe(
      'Keep personal metadata'
    );
    expect(downloadStringsFile).toHaveBeenCalledTimes(1);
    expect(downloadStringsFile).toHaveBeenCalledWith(OLD_VERSION);
  });

  it('recognizes any exact old body for an ID with several catalogue variants', async () => {
    await seed('history-policy', 'Alternate stock ${OLD_LABEL}.');
    history([oldPrompt(), oldPrompt('history-policy', 'Alternate stock ')]);

    const result = await syncPrompt(prompt());
    const updated = await readPromptFile('history-policy');

    expect(result.action).toBe('updated');
    expect(updated.content.trim()).toBe(NEW_BODY);
    expect(updated.variables).toEqual(['NEW_LABEL']);
  });
});

describe('personal prompt conflict preservation', () => {
  it.each([
    ['custom instructions', CUSTOM_BODY],
    ['intentional suppression', ''],
  ])(
    'leaves %s and frontmatter byte identical on conflict',
    async (_case, body) => {
      const original = await seed('history-policy', body);
      history();

      const result = await syncPrompt(prompt());
      const actual = await fs.readFile(
        path.join(SYSTEM_PROMPTS_DIR, 'history-policy.md'),
        'utf8'
      );

      expect(result.action).toBe('conflict');
      expect(result.diffHtmlPath).toBe('fixture-conflict.html');
      expect(actual).toBe(original);
    }
  );

  it('keeps the existing file intact when the declared catalogue cannot load', async () => {
    const original = await seed();
    vi.mocked(downloadStringsFile).mockRejectedValue(
      new Error('Historical catalogue unavailable')
    );

    const result = await syncPrompt(prompt());
    const actual = await fs.readFile(
      path.join(SYSTEM_PROMPTS_DIR, 'history-policy.md'),
      'utf8'
    );

    expect(result.action).toBe('conflict');
    expect(result.diffHtmlPath).toBe('fixture-conflict.html');
    expect(actual).toBe(original);
  });
});

describe('historical lookup boundaries', () => {
  it('uses an existing matching hash without downloading historical catalogue data', async () => {
    await seed();
    await storeHashes(catalogue(OLD_VERSION, [oldPrompt()]));
    vi.mocked(downloadStringsFile).mockRejectedValue(
      new Error('Unexpected historical download')
    );

    const result = await syncPrompt(prompt());
    const updated = await readPromptFile('history-policy');

    expect(result.action).toBe('updated');
    expect(updated.content.trim()).toBe(NEW_BODY);
    expect(downloadStringsFile).not.toHaveBeenCalled();
  });

  it('downloads a shared old catalogue once per complete synchronization', async () => {
    await seed('first-policy');
    await seed('second-policy');
    const current = catalogue(NEW_VERSION, [
      prompt('first-policy'),
      prompt('second-policy'),
    ]);
    const previous = catalogue(OLD_VERSION, [
      oldPrompt('first-policy'),
      oldPrompt('second-policy'),
    ]);
    vi.mocked(downloadStringsFile).mockImplementation(async version => {
      const files = new Map([
        [NEW_VERSION, current],
        [OLD_VERSION, previous],
      ]);
      const selected = files.get(version);
      if (!selected) throw new Error(`Unexpected version ${version}`);
      return selected;
    });

    const result = await syncSystemPrompts(NEW_VERSION);
    const first = await readPromptFile('first-policy');
    const second = await readPromptFile('second-policy');

    expect(result.results.map(item => item.action)).toEqual([
      'updated',
      'updated',
    ]);
    expect(first.content.trim()).toBe(NEW_BODY);
    expect(second.content.trim()).toBe(NEW_BODY);
    expect(vi.mocked(downloadStringsFile).mock.calls).toEqual([
      [NEW_VERSION],
      [OLD_VERSION],
    ]);
  });
});
