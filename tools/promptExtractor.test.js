import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const extractStrings = require('./promptExtractor.js');
const {
  leadShowsModelFacingContext,
  leadShowsDropContext,
  contentIsModelFacingShortPrompt,
  validateInput,
  ADMIT_FLOOR,
} = extractStrings;

// These tests lock the BELOW-FLOOR capture rules with SYNTHETIC inputs, so they
// stay valid across CC version bumps (they never depend on a specific cli.js).
// The signals are stable JS keywords / JSON-schema keys / Anthropic-controlled
// property names — never bundler-minified identifiers — which is what makes the
// extractor's "capture everything the model sees" behavior battleproof.

describe('promptExtractor below-floor capture', () => {
  describe('leadShowsModelFacingContext (stable model-facing emission sites)', () => {
    it('captures JSON-schema tool params {type,description}', () => {
      expect(leadShowsModelFacingContext('{type:"string",description:')).toBe(true);
      expect(leadShowsModelFacingContext('{type:"number",minimum:1,description:')).toBe(true);
    });
    it('captures tool/agent/skill definitions {name,...,description}', () => {
      expect(leadShowsModelFacingContext('[{name:Pz1,description:')).toBe(true);
      expect(leadShowsModelFacingContext('{name:"Grep",inputSchema:x,description:')).toBe(true);
    });
    it('captures descriptionForModel, tool-result text, whenToUse', () => {
      expect(leadShowsModelFacingContext('descriptionForModel:')).toBe(true);
      expect(leadShowsModelFacingContext('{type:"text",text:')).toBe(true);
      expect(leadShowsModelFacingContext('whenToUse:')).toBe(true);
    });
    it('does NOT fire on a bare/unpaired description: or arbitrary calls', () => {
      expect(leadShowsModelFacingContext('config={description:')).toBe(false);
      expect(leadShowsModelFacingContext('foo(')).toBe(false);
      expect(leadShowsModelFacingContext('x = ')).toBe(false);
    });
  });

  describe('leadShowsDropContext (stable non-model-facing emission sites)', () => {
    it('drops thrown exceptions', () => {
      expect(leadShowsDropContext('throw new Error(')).toBe(true);
      expect(leadShowsDropContext('throw new ndH(')).toBe(true);
      expect(leadShowsDropContext('throw Z(')).toBe(true);
    });
    it('drops console + stderr/stdout writes', () => {
      expect(leadShowsDropContext('console.error(')).toBe(true);
      expect(leadShowsDropContext('console.log(')).toBe(true);
      expect(leadShowsDropContext('process.stderr.write(')).toBe(true);
    });
    it('drops React/Ink children and CLI --help builders', () => {
      expect(leadShowsDropContext('wA.createElement(dP,{color:"warning"},')).toBe(true);
      expect(leadShowsDropContext('.option(')).toBe(true);
      expect(leadShowsDropContext('.command(')).toBe(true);
    });
    it('does NOT fire on model-facing sites', () => {
      expect(leadShowsDropContext('{type:"string",description:')).toBe(false);
      expect(leadShowsDropContext('{name:X,description:')).toBe(false);
      expect(leadShowsDropContext('return ')).toBe(false);
    });
  });

  describe('contentIsModelFacingShortPrompt', () => {
    it('captures a real <system-reminder> block but not a prose mention', () => {
      expect(contentIsModelFacingShortPrompt('<system-reminder>\nDo X.\n</system-reminder>')).toBe(true);
      expect(
        contentIsModelFacingShortPrompt('Agent types are listed in <system-reminder> messages.')
      ).toBe(false);
    });
  });

  describe('validateInput floor + bypass', () => {
    it('rejects unsignalled strings below ADMIT_FLOOR', () => {
      expect(validateInput('too short', ADMIT_FLOOR)).toBe(false);
    });
    it('bypassQuality admits short single-sentence tool descriptions', () => {
      // No "you/must/should" + single sentence -> would fail prose-quality gates,
      // but a model-facing lead signal sets bypassQuality.
      const shortToolDesc = 'The symbol name to search for in the workspace.';
      expect(validateInput(shortToolDesc, ADMIT_FLOOR)).toBe(false);
      expect(validateInput(shortToolDesc, 1, { bypassQuality: true })).toBe(true);
    });
  });

  describe('end-to-end extractStrings on a synthetic snippet', () => {
    const run = (code) => {
      const f = path.join(os.tmpdir(), `pe-test-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
      fs.writeFileSync(f, code);
      try {
        return extractStrings(f).prompts.map((p) =>
          (p.pieces || []).filter((x) => typeof x === 'string').join('')
        );
      } finally {
        fs.unlinkSync(f);
      }
    };

    it('captures a model-facing JSON-schema param below the old 500 floor', () => {
      const desc = 'The complete question to ask the user. Should be clear and specific.';
      const bodies = run(`var t={type:"string",description:${JSON.stringify(desc)}};`);
      expect(bodies).toContain(desc);
    });

    it('drops a thrown error of the same length', () => {
      const msg = 'The complete question to ask the user. Should be clear and specific.';
      const bodies = run(`function f(){throw new Error(${JSON.stringify(msg)})}`);
      expect(bodies).not.toContain(msg);
    });

    it('drops a createElement (Ink UI) child', () => {
      const ui = 'Voice connection failed. Check your network and try again now.';
      const bodies = run(`var e=X.createElement(B,{color:"red"},${JSON.stringify(ui)});`);
      expect(bodies).not.toContain(ui);
    });

    it('still captures an above-floor prose prompt (no baseline regression)', () => {
      const long =
        'You are an interactive CLI tool. You must always be helpful and you should ' +
        'follow instructions carefully. '.repeat(20);
      const bodies = run(`var s=${JSON.stringify(long)};`);
      expect(bodies.some((b) => b.includes('interactive CLI tool'))).toBe(true);
    });
  });
});
