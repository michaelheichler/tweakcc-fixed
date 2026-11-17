import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySystemPrompts } from './patches/systemPrompts';
import {
  replayPromptPlans,
  runSystemPromptPreflight,
} from './systemPromptPreflight';
import { OffsetMapper } from './systemPromptSites';
import * as promptSync from './systemPromptSync';

vi.mock('./systemPromptSync', async () => {
  const actual = await vi.importActual('./systemPromptSync');
  return {
    ...actual,
    loadSystemPromptsWithRegex: vi.fn(),
    pristineBodiesById: vi.fn(),
  };
});

vi.mock('./patches/systemReminderOverrides', () => ({ REMINDER_REGISTRY: [] }));

type LoadedPrompt = Awaited<
  ReturnType<typeof promptSync.loadSystemPromptsWithRegex>
>[number];

const VERSION = '2.1.325';
const STOCK = 'Shared stock policy.';
const ALTERNATE = 'Alternate stock policy.';
const CUSTOM = 'Follow the personal project workflow.';
const AMBIGUOUS =
  'const first="Shared stock policy.";const second="Shared stock policy.";';

function entry(id: string, baseline: string, content = baseline): LoadedPrompt {
  return {
    promptId: id,
    regex: baseline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    pieces: [baseline],
    identifiers: [],
    identifierMap: {},
    getInterpolatedContent: () => content,
    prompt: {
      name: id,
      description: 'Prompt fixture.',
      ccVersion: VERSION,
      contentLineOffset: 0,
      content,
    },
  };
}

function load(entries: LoadedPrompt[]) {
  vi.mocked(promptSync.loadSystemPromptsWithRegex).mockResolvedValue(entries);
  const bodies = new Map<string, Set<string>>();
  for (const item of entries) {
    const group = bodies.get(item.promptId) ?? new Set<string>();
    group.add(item.pieces.join(''));
    bodies.set(item.promptId, group);
  }
  vi.mocked(promptSync.pristineBodiesById).mockResolvedValue(bodies);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('single canonical prompt stubs', () => {
  it('applies an ambiguous untouched single stub without warning or mutation', async () => {
    load([entry('stock-policy', STOCK)]);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await applySystemPrompts(AMBIGUOUS, VERSION, false);

    expect(result.newContent).toBe(AMBIGUOUS);
    expect(result.results.map(item => item.applied)).toEqual([false]);
    expect(logs.mock.calls).toEqual([]);
  });

  it('validates an ambiguous untouched single stub without findings', async () => {
    load([entry('stock-policy', STOCK)]);

    const result = await runSystemPromptPreflight({
      pristine: AMBIGUOUS,
      version: VERSION,
    });

    expect(result.findings).toEqual([]);
  });
});

describe('same-ID canonical prompt variants', () => {
  it('keeps all variants untouched when the shared stub uses the first body', async () => {
    load([
      entry('variant-policy', STOCK),
      entry('variant-policy', ALTERNATE, STOCK),
    ]);
    const content =
      AMBIGUOUS +
      'const third="Alternate stock policy.";const fourth="Alternate stock policy.";';
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await applySystemPrompts(content, VERSION, false);

    expect(result.newContent).toBe(content);
    expect(result.results.map(item => item.applied)).toEqual([false, false]);
    expect(logs.mock.calls).toEqual([]);
  });

  it('validates stock variants without reporting their ambiguous matches', async () => {
    load([
      entry('variant-policy', STOCK),
      entry('variant-policy', ALTERNATE, STOCK),
    ]);

    const result = await runSystemPromptPreflight({
      pristine:
        AMBIGUOUS +
        'const third="Alternate stock policy.";const fourth="Alternate stock policy.";',
      version: VERSION,
    });

    expect(result.findings).toEqual([]);
  });
});

describe('ambiguous personal overrides', () => {
  it('warns without applying an ambiguous personal override', async () => {
    load([entry('personal-policy', STOCK, CUSTOM)]);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await applySystemPrompts(AMBIGUOUS, VERSION, false);

    expect(result.newContent).toBe(AMBIGUOUS);
    expect(result.results.map(item => item.applied)).toEqual([false]);
    expect(result.results[0].details).toMatch(/ambiguous/);
    expect(logs.mock.calls).toHaveLength(1);
    expect(logs.mock.calls[0][0]).toMatch(/skipping/);
  });

  it('retains a cardinality warning for an ambiguous personal override', async () => {
    load([entry('personal-policy', STOCK, CUSTOM)]);

    const result = await runSystemPromptPreflight({
      pristine: AMBIGUOUS,
      version: VERSION,
    });

    expect(result.findings).toEqual([
      expect.objectContaining({
        id: 'personal-policy',
        check: 'cardinality',
        severity: 'warning',
      }),
    ]);
  });
});

describe('mixed canonical and authored shapes', () => {
  it('retains the pristine sibling ordinal before an authored shared-shape entry', async () => {
    load([
      entry('stock-policy', STOCK),
      entry('personal-policy', STOCK, CUSTOM),
    ]);

    const result = await applySystemPrompts(AMBIGUOUS, VERSION, false);
    const selected = runInNewContext(`${result.newContent}[first,second]`);

    expect(Array.from(selected)).toEqual([STOCK, CUSTOM]);
    expect(result.results.map(item => item.applied)).toEqual([false, true]);
  });

  it('validates a mixed group using its full catalogue multiplicity', async () => {
    load([
      entry('stock-policy', STOCK),
      entry('personal-policy', STOCK, CUSTOM),
    ]);

    const result = await runSystemPromptPreflight({
      pristine: AMBIGUOUS,
      version: VERSION,
    });

    expect(result.findings).toEqual([]);
    expect(result.sitesChecked).toBe(2);
  });
});

describe('mixed canonical replay ordinals', () => {
  it('splices the authored second site after a retained canonical sibling', async () => {
    const start = AMBIGUOUS.lastIndexOf(STOCK);
    const result = await replayPromptPlans(
      AMBIGUOUS,
      new OffsetMapper(),
      [
        {
          claim: {
            id: 'personal-policy',
            site: 1,
            start,
            end: start + STOCK.length,
            replacement: CUSTOM,
            surface: 'prompt',
            mutates: true,
            body: CUSTOM,
          },
          regex: 'Shared stock policy\\.',
          spec: {
            regex: 'Shared stock policy\\.',
            pieces: [STOCK],
            version: VERSION,
          },
          order: 1,
          groupMultiplicity: 2,
          priorCanonicalSites: 1,
          getInterpolatedContent: () => CUSTOM,
        },
      ],
      false
    );
    const selected = runInNewContext(`${result.content}[first,second]`);

    expect(Array.from(selected)).toEqual([STOCK, CUSTOM]);
    expect(result.mutations).toHaveLength(1);
  });
});
