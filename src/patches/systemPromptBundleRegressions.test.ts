import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applySystemPrompts } from './systemPrompts';
import * as promptSync from '../systemPromptSync';
import * as hashIndex from '../systemPromptHashIndex';
import { moduleCountDeclaration, moduleSentinel } from '../virtualBundle';

vi.mock('../systemPromptSync', async () => {
  const actual = await vi.importActual('../systemPromptSync');
  return { ...actual, loadSystemPromptsWithRegex: vi.fn() };
});

vi.mock('../systemPromptHashIndex', async () => {
  const actual = await vi.importActual('../systemPromptHashIndex');
  return { ...actual, setAppliedHashes: vi.fn() };
});

type LoadedPrompt = Awaited<
  ReturnType<typeof promptSync.loadSystemPromptsWithRegex>
>[number];

const promptEntry = (
  promptId: string,
  sharedText: string,
  replacement: string,
  asset?: string,
  promptContent = replacement
): LoadedPrompt => ({
  promptId,
  regex: sharedText,
  asset,
  prompt: {
    name: 'Bundle prompt',
    description: 'Instructions for a bundle region.',
    ccVersion: '2.1.322',
    content: promptContent,
    contentLineOffset: 0,
  },
  pieces: [sharedText],
  getInterpolatedContent: () => replacement,
  identifiers: [],
  identifierMap: {},
});

const virtualBundle = (jsText: string, assetText: string): string =>
  moduleCountDeclaration(1) +
  moduleSentinel(0, 'entry.js') +
  `let value="${jsText}";` +
  moduleSentinel(1, 'guide.md') +
  `\`${assetText}\``;

describe('system prompt application in virtual bundles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hashIndex.setAppliedHashes).mockResolvedValue();
  });

  it('patches a shared JS and asset matcher after the JS replacement shifts offsets', async () => {
    const sharedText = 'Run /model to switch';
    const content = virtualBundle(sharedText, sharedText);
    const entries = [
      promptEntry('js-help', sharedText, 'Use /model in code.'),
      promptEntry(
        'asset-help',
        sharedText,
        'Use /model in the guide.',
        '/$bunfs/root/guide.md'
      ),
    ];
    vi.mocked(promptSync.loadSystemPromptsWithRegex).mockResolvedValue(entries);

    const result = await applySystemPrompts(content, '2.1.322', false);

    expect(result.newContent).toContain('let value="Use /model in code.";');
    expect(result.newContent).toContain('`Use /model in the guide.`');
  });

  it('leaves byte-identical shared pristine shapes untouched', async () => {
    const sharedText = 'Keep this prompt wording.';
    const content = virtualBundle(sharedText, sharedText);
    const entries = [
      promptEntry(
        'shared-help',
        sharedText,
        'Unexpected interpolation.',
        undefined,
        sharedText
      ),
      promptEntry(
        'shared-help',
        sharedText,
        'Unexpected interpolation.',
        '/$bunfs/root/guide.md',
        sharedText
      ),
    ];
    vi.mocked(promptSync.loadSystemPromptsWithRegex).mockResolvedValue(entries);

    const result = await applySystemPrompts(content, '2.1.322', false);

    expect(result.newContent).toBe(content);
  });
});
