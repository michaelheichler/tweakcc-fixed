import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const fixture = await vi.hoisted(async () => {
  const filesystem = await import('node:fs');
  const os = await import('node:os');
  const paths = await import('node:path');
  const root = filesystem.mkdtempSync(
    paths.join(os.tmpdir(), 'cooperation-apply-')
  );
  const previous = process.env.TWEAKCC_CONFIG_DIR;
  process.env.TWEAKCC_CONFIG_DIR = root;
  return { root, previous };
});

vi.mock('../systemPromptSync', async () => {
  const actual = await vi.importActual('../systemPromptSync');
  return { ...actual, loadSystemPromptsWithRegex: vi.fn() };
});

vi.mock('../systemPromptHashIndex', async () => {
  const actual = await vi.importActual('../systemPromptHashIndex');
  return { ...actual, setAppliedHashes: vi.fn() };
});

import { CONFIG_DIR } from '../config';
import { loadSystemPromptsWithRegex } from '../systemPromptSync';
import { setAppliedHashes } from '../systemPromptHashIndex';
import { applySystemPrompts } from './systemPrompts';

const POLICY = 'Read all required sources before dependent edits.';
const WRAPPER =
  'function selectPrompt(request){let{prompt:blocks,servesDefault:defaulted}=choose(request);' +
  'if(!defaulted&&!request.analysisOnly)notify(!1);return blocks}';
const BUILDER =
  'async function buildPrompt(e,n,r){let s=await selectStored(()=>livePrompt(e,n,r),' +
  '(h)=>h===void 0?freshPrompt(e,n,r):recordedPrompt(h,e,r?.isDetached===!0));' +
  'return cleanup(s,extraEnabled()?extraPrompt:null).map((h)=>wrap(h))}';
const SUBAGENT =
  'function subagentPrompt(e,n,r){let s=isLean(n),h=agentTools(n,r),' +
  'y=s?leanCwd:"- Agent threads always have their cwd reset between bash calls, as a result please only use absolute file paths.",' +
  'E=s?leanProvenance:"Parent messages.",v=s?leanNotes(y):`Notes:\n${y}`,' +
  'H=privacyEnabled()?[`- ${privacyNote}`]:[],q=budget(h);' +
  'return[...e,...[E,[v,...H].join(`\n`),...q!==null?[q]:[]].map((Y)=>wrap(Y))]}';
const SOURCE =
  'const greeting="Stock introduction.";' +
  'function choose(){return{prompt:[greeting],servesDefault:true}}' +
  WRAPPER +
  BUILDER +
  SUBAGENT;
const policyFile = path.join(fixture.root, 'user-cooperation.md');

function introductionOverride() {
  return {
    promptId: 'introduction',
    regex: 'Stock introduction\\.',
    pieces: ['Stock introduction.'],
    identifiers: [],
    identifierMap: {},
    prompt: {
      name: 'Introduction',
      description: 'A short introduction.',
      ccVersion: '2.1.325',
      content: 'Optimized introduction.',
      contentLineOffset: 0,
    },
    getInterpolatedContent: () => 'Optimized introduction.',
  };
}

function selectedPrompt(source: string): string[] {
  return Array.from(
    runInNewContext(
      `${source};selectPrompt({})`,
      {},
      {
        timeout: 1000,
      }
    )
  );
}

beforeEach(() => {
  expect(CONFIG_DIR).toBe(fixture.root);
  vi.clearAllMocks();
  vi.mocked(loadSystemPromptsWithRegex).mockResolvedValue([
    introductionOverride(),
  ]);
  vi.mocked(setAppliedHashes).mockResolvedValue();
});

afterEach(() => fs.rmSync(policyFile, { force: true }));
afterAll(() => {
  fs.rmSync(fixture.root, { recursive: true, force: true });
  if (fixture.previous === undefined) delete process.env.TWEAKCC_CONFIG_DIR;
  else process.env.TWEAKCC_CONFIG_DIR = fixture.previous;
});

describe('optional cooperation policy during normal prompt application', () => {
  it('applies normal overrides when no cooperation policy file exists', async () => {
    const result = await applySystemPrompts(SOURCE, '2.1.325', false);

    expect(selectedPrompt(result.newContent)).toEqual([
      'Optimized introduction.',
    ]);
    expect(result.results).toEqual([
      expect.objectContaining({
        id: 'introduction',
        applied: true,
      }),
    ]);
  });

  it('adds the configured policy after applying ordinary prompt overrides', async () => {
    fs.writeFileSync(policyFile, `\n${POLICY}\n`);

    const result = await applySystemPrompts(SOURCE, '2.1.325', false);

    expect(selectedPrompt(result.newContent)).toEqual([
      'Optimized introduction.',
      POLICY,
    ]);
    expect(result.results).toEqual([
      expect.objectContaining({ id: 'introduction', applied: true }),
      expect.objectContaining({
        id: 'user-cooperation',
        applied: true,
        modelFacing: true,
      }),
    ]);
  });

  it('keeps targeted prompt application scoped to its selected override', async () => {
    fs.writeFileSync(policyFile, POLICY);
    const sourceWithoutAgentPaths = SOURCE.replace(BUILDER + SUBAGENT, '');

    const result = await applySystemPrompts(
      sourceWithoutAgentPaths,
      '2.1.325',
      false,
      ['introduction']
    );

    expect(selectedPrompt(result.newContent)).toEqual([
      'Optimized introduction.',
    ]);
    expect(result.results).toEqual([
      expect.objectContaining({
        id: 'introduction',
        applied: true,
      }),
    ]);
  });
});

describe('cooperation policy coverage before returning patched source', () => {
  it.each([SOURCE.replace(SUBAGENT, ''), SOURCE + WRAPPER])(
    'rejects configured policies when a required route is missing or ambiguous',
    async source => {
      fs.writeFileSync(policyFile, POLICY);

      await expect(
        applySystemPrompts(source, '2.1.325', false)
      ).rejects.toThrow(/missing or ambiguous sites/);
    }
  );
});
