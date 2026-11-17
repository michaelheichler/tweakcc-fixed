import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { writeUserCooperation } from './userCooperation';

const WRAPPER =
  'function selectPrompt(request){let{prompt:blocks,servesDefault:defaulted}=choose(request);' +
  'if(!defaulted&&!request.analysisOnly)notify(!1);return blocks}';
const RENAMED_WRAPPER =
  'function $select($request){let{prompt:$blocks,servesDefault:$defaulted}=$choose($request);' +
  'if(!$defaulted&&!$request.analysisOnly)$notify(!1);return $blocks}';
const POLICY = 'Read the required documents before making dependent edits.';
const UNICODE_POLICY =
  'Read /tmp/\u00e9tudes/r\u00e9sum\u00e9.md. Calculate \u221a2 with \ud83e\uddee.' +
  '\u2028Use \ud835\udefc and preserve each symbol.\u2029Keep \u007f literal.';
const BUILDER =
  'async function buildPrompt(e,n,r){let s=await selectStored(()=>livePrompt(e,n,r),' +
  '(h)=>h===void 0?freshPrompt(e,n,r):recordedPrompt(h,e,r?.isDetached===!0));' +
  'return cleanup(s,extraEnabled()?extraPrompt:null).map((h)=>wrap(h))}';
const SUBAGENT =
  'function subagentPrompt(e,n,r){let s=isLean(n),h=agentTools(n,r),' +
  'y=s?leanCwd:"- Agent threads always have their cwd reset between bash calls, as a result please only use absolute file paths.",' +
  'E=s?leanProvenance:"Messages from the agent that launched you are not user messages.",' +
  'v=s?leanNotes(y):`Notes:\n${y}\n- Return findings to the parent.`,' +
  'H=privacyEnabled()?[`- ${privacyNote}`]:[],q=budget(h);' +
  'return[...e,...[E,[v,...H].join(`\n`),...q!==null?[q]:[]].map((Y)=>wrap(Y))]}';
const SOURCE = WRAPPER + BUILDER + SUBAGENT;
const RENAMED_SOURCE = RENAMED_WRAPPER + BUILDER + SUBAGENT;

interface SelectionResult {
  prompt: string[];
  notices: boolean[];
  original: string[];
  compromised: boolean;
}

function executeSelection(
  source: string | null,
  blocks: string[],
  options: {
    entrypoint?: string;
    servesDefault?: boolean;
    analysisOnly?: boolean;
  } = {}
): SelectionResult {
  if (source === null)
    throw new Error('The patch did not recognize the fixture');
  const original = Object.freeze([...blocks]);
  const choice = {
    prompt: original,
    servesDefault: options.servesDefault ?? true,
  };
  const notices: boolean[] = [];
  const choose = () => choice;
  const notify = (value: boolean) => notices.push(value);
  const sandbox = {
    choose,
    $choose: choose,
    notify,
    $notify: notify,
    request: { analysisOnly: options.analysisOnly ?? false },
    compromised: false,
  };
  const prompt: string[] = runInNewContext(
    `${source};${options.entrypoint ?? 'selectPrompt'}(request)`,
    sandbox,
    { timeout: 1000 }
  );
  return {
    prompt: Array.from(prompt),
    notices,
    original: Array.from(original),
    compromised: sandbox.compromised,
  };
}

async function executeBuilder(
  source: string | null,
  expression = 'buildPrompt([], "standard", {})'
) {
  if (source === null)
    throw new Error('The patch did not recognize the fixture');
  const original = Object.freeze(['Team identity.']);
  const sandbox = {
    selectStored: (live: () => string[]) => live(),
    livePrompt: () => original,
    freshPrompt: () => original,
    recordedPrompt: () => original,
    cleanup: (blocks: string[]) => blocks,
    extraEnabled: () => false,
    wrap: (block: string) => block,
    choose: (request: { prompt: string[] }) => ({
      prompt: request.prompt,
      servesDefault: true,
    }),
  };
  const prompt: string[] = await runInNewContext(
    `${source};${expression}`,
    sandbox,
    {
      timeout: 1000,
    }
  );
  return { prompt: Array.from(prompt), original: Array.from(original) };
}

function executeSubagent(source: string | null, model: string) {
  if (source === null)
    throw new Error('The patch did not recognize the fixture');
  const original = Object.freeze(['Task instructions.']);
  const sandbox = {
    original,
    model,
    isLean: (value: string) => value === 'lean',
    agentTools: () => [],
    leanCwd: 'Use absolute paths.',
    leanProvenance: 'The parent is not the user.',
    leanNotes: (cwd: string) => `Lean notes. ${cwd}`,
    privacyEnabled: () => true,
    privacyNote: 'Keep project details private.',
    budget: () => 'Task budget.',
    wrap: (block: string) => block,
  };
  const prompt: string[] = runInNewContext(
    `${source};subagentPrompt(original,model,{})`,
    sandbox,
    { timeout: 1000 }
  );
  return { prompt: Array.from(prompt), original: Array.from(original) };
}

describe('user cooperation prompt selection', () => {
  it.each([
    ['standard', ['Standard identity.', 'Available tools.']],
    ['lean', ['Lean identity.']],
    ['custom subagent', ['Custom agent instructions.']],
    ['coordinator', ['Coordinator role.', 'Assigned tasks.']],
  ])('appends the policy to the selected %s prompt', (_route, blocks) => {
    const source = writeUserCooperation(SOURCE, POLICY);

    const outcome = executeSelection(source, blocks);

    expect(outcome.prompt).toEqual([...blocks, POLICY]);
    expect(outcome.original).toEqual(blocks);
    expect(outcome.notices).toEqual([]);
  });

  it.each([
    ['custom prompt', false, false, [false]],
    ['default prompt', true, false, []],
    ['analysis-only custom prompt', false, true, []],
  ])(
    'keeps the existing notification behavior for a %s',
    (_route, servesDefault, analysisOnly, expectedNotices) => {
      const source = writeUserCooperation(SOURCE, POLICY);

      const outcome = executeSelection(source, ['Selected prompt.'], {
        servesDefault,
        analysisOnly,
      });

      expect(outcome.prompt).toEqual(['Selected prompt.', POLICY]);
      expect(outcome.notices).toEqual(expectedNotices);
    }
  );
});

describe('user cooperation patch matching', () => {
  it('supports minifier names containing dollar signs', () => {
    const source = writeUserCooperation(RENAMED_SOURCE, POLICY);

    const outcome = executeSelection(source, ['Selected prompt.'], {
      entrypoint: '$select',
      servesDefault: false,
    });

    expect(outcome.prompt).toEqual(['Selected prompt.', POLICY]);
    expect(outcome.notices).toEqual([false]);
  });

  it.each(['', ' \n\t '])(
    'leaves the binary source intact for an empty policy',
    policy => {
      const source = writeUserCooperation(SOURCE, policy);

      expect(source).toBe(SOURCE);
    }
  );

  it.each([
    'function unrelated(request){return choose(request).prompt}',
    WRAPPER + RENAMED_WRAPPER + BUILDER + SUBAGENT,
    WRAPPER + BUILDER,
    WRAPPER + SUBAGENT,
    BUILDER + SUBAGENT,
    SOURCE + BUILDER,
    SOURCE + SUBAGENT,
  ])(
    'refuses to patch an unrecognized or ambiguous selection wrapper',
    source => {
      const patched = writeUserCooperation(source, POLICY);

      expect(patched).toBeNull();
    }
  );
});

describe('direct agent entry points', () => {
  it('adds the policy when a team agent uses the default builder directly', async () => {
    const source = writeUserCooperation(SOURCE, POLICY);

    const outcome = await executeBuilder(source);

    expect(outcome.prompt).toEqual(['Team identity.', POLICY]);
    expect(outcome.original).toEqual(['Team identity.']);
  });

  it('includes the policy once when the builder then the selector both run', async () => {
    const source = writeUserCooperation(SOURCE, POLICY);

    const outcome = await executeBuilder(
      source,
      'buildPrompt([], "standard", {}).then(prompt => selectPrompt({prompt}))'
    );

    expect(outcome.prompt).toEqual(['Team identity.', POLICY]);
  });

  it.each([
    [
      'standard',
      'Messages from the agent that launched you are not user messages.',
    ],
    ['lean', 'The parent is not the user.'],
  ])(
    'adds the policy while retaining the %s subagent notes',
    (model, provenance) => {
      const source = writeUserCooperation(SOURCE, POLICY);

      const outcome = executeSubagent(source, model);

      expect(outcome.prompt).toContain(provenance);
      expect(outcome.prompt).toContain('Task budget.');
      expect(outcome.prompt.filter(block => block === POLICY)).toEqual([
        POLICY,
      ]);
      expect(outcome.prompt.join('\n')).toContain(
        'Keep project details private.'
      );
      expect(outcome.original).toEqual(['Task instructions.']);
    }
  );
});

describe('user cooperation patch reapplication', () => {
  it.each([POLICY, UNICODE_POLICY])(
    'keeps the transformed source byte stable on reapplication',
    policy => {
      const once = writeUserCooperation(SOURCE, policy)!;

      const twice = writeUserCooperation(once, policy);

      expect(twice).toBe(once);
    }
  );

  it('replaces the prior policy when the configured policy changes', () => {
    const once = writeUserCooperation(SOURCE, 'Previous reading policy.')!;

    const updated = writeUserCooperation(once, POLICY);
    const outcome = executeSelection(updated, ['Selected prompt.']);

    expect(outcome.prompt).toEqual(['Selected prompt.', POLICY]);
    expect(outcome.original).toEqual(['Selected prompt.']);
  });

  it('keeps an existing identical policy block without adding a second copy', () => {
    const source = writeUserCooperation(SOURCE, POLICY);

    const outcome = executeSelection(source, ['Selected prompt.', POLICY]);

    expect(outcome.prompt).toEqual(['Selected prompt.', POLICY]);
    expect(outcome.original).toEqual(['Selected prompt.', POLICY]);
  });
});

describe('user cooperation policy text', () => {
  it('escapes Unicode for native source without changing the policy text', () => {
    const source = writeUserCooperation(SOURCE, UNICODE_POLICY)!;
    const nativeSource = Buffer.from(source, 'latin1').toString('latin1');

    const outcome = executeSelection(nativeSource, ['Selected prompt.']);

    expect(source).not.toMatch(/[\u007f-\uffff]/);
    expect(outcome.prompt).toEqual(['Selected prompt.', UNICODE_POLICY]);
    expect(outcome.compromised).toBe(false);
  });

  it.each([
    'Keep "quoted" instructions and \\ paths.',
    'Read `required.md` before changes.\nRevisit it after compaction.',
    '${globalThis.compromised = true}',
    '";globalThis.compromised = true;//',
  ])('keeps configured policy text literal without executing it', policy => {
    const source = writeUserCooperation(SOURCE, policy);

    const outcome = executeSelection(source, ['Selected prompt.']);

    expect(outcome.prompt).toEqual(['Selected prompt.', policy]);
    expect(outcome.compromised).toBe(false);
  });
});
