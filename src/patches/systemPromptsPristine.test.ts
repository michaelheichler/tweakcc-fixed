import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applySystemPrompts } from './systemPrompts';
import * as promptSync from '../systemPromptSync';
import * as systemPromptHashIndex from '../systemPromptHashIndex';

vi.mock('../systemPromptSync', async () => {
  const actual = await vi.importActual('../systemPromptSync');
  return {
    ...actual,
    loadSystemPromptsWithRegex: vi.fn(),
    loadIdentifierMapUnion: vi.fn(),
  };
});

vi.mock('../systemPromptHashIndex', async () => {
  const actual = await vi.importActual('../systemPromptHashIndex');
  return { ...actual, setAppliedHashes: vi.fn() };
});

const promptSite = (regex: string, pristine: string) => ({
  promptId: 'shared-prompt',
  prompt: {
    name: 'Shared Prompt',
    description: 'Test',
    ccVersion: '1.0.0',
    contentLineOffset: 0,
    variables: [],
    content: 'Outer inner text',
  },
  regex,
  getInterpolatedContent: () => 'Outer inner text',
  pieces: [pristine],
  identifiers: [],
  identifierMap: {},
});

describe('pristine shared prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(promptSync.loadIdentifierMapUnion).mockResolvedValue(new Set());
    vi.mocked(systemPromptHashIndex.setAppliedHashes).mockResolvedValue();
  });

  it('does not inject one site into a differently shaped sibling site', async () => {
    vi.mocked(promptSync.loadSystemPromptsWithRegex).mockResolvedValue([
      promptSite('Outer inner text', 'Outer inner text'),
      promptSite('inner text', 'inner text'),
    ]);
    const cliContent = 'value="Outer inner text";other="inner text"';

    const result = await applySystemPrompts(cliContent, '1.0.0', false);

    expect(result.newContent).toBe(cliContent);
    expect(result.results).toHaveLength(2);
    expect(result.results.every(item => item.skipped)).toBe(true);
  });
});
