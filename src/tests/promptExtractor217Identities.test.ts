import { describe, expect, it } from 'vitest';
import cache from '../../data/prompt-classification.json';

describe('2.1.217 prompt classifications', () => {
  const modelEntries = {
    '5c7bc532e2334616d32f1fdab37fd262964a3885':
      'system-prompt-correction-restraint',
    '2f4ea081e75826b18d790a3b25c04cbc4cc509f8': 'system-prompt-scope-fidelity',
    '86da7df53268e5ba171a8b1342de89753f18fd47':
      'system-prompt-delivering-work-at-full-scope',
    b9eb4c95468f1a94eff64917a62ae9a97ffce678:
      'skill-artifact-pr-review-html-template',
    '1372769eacd13259dc674b688379cab373d22b10':
      'tool-result-subagent-budget-limit',
    '72457ac68fe750b25bd1af0dc0749ea1fc7c249a':
      'tool-result-subagent-concurrency-limit',
    '6b5804caeb6d82b4c978c365e2e45dbf2bb81f2c':
      'skill-explain-usage-description',
    '1df48c066c75cfc05a55618eaf157d67b8457e81':
      'tool-result-import-digest-mismatch',
    '3f17854c127202dd3e73b54ac5262f8b8290ebc8':
      'skill-explain-usage-slash-command',
    d39864eda4b577c428d47c49d2fbaa0bab2387c8:
      'tool-result-network-shaped-cwd-guard',
    '7069278f33df08d8cc13d3ccd9e3e5b06a2f963f':
      'tool-result-network-shaped-write-guard',
  } as const;

  const nonModelEntries = {
    df27516383462e47d9dc74aa88d6a83fc9125426: 'ui',
    d2af8d3f2eceffc1b148813e4b7e730b8ea50ad1: 'internal',
    d64209554df3f992f0b265ec8c5f446019c6b419: 'internal',
    d036cbb2dc2172fb4a9002044261fdb6508017eb: 'ui',
    bb83814a39e57d23f9eeff2bad8b2903d6339041: 'internal',
  } as const;

  it.each(Object.entries(modelEntries))('names %s', (hash, id) => {
    expect(cache[hash as keyof typeof cache]).toMatchObject({
      facing: 'model',
      id,
    });
  });

  it.each(Object.entries(nonModelEntries))('drops %s', (hash, facing) => {
    expect(cache[hash as keyof typeof cache]).toEqual({ facing });
  });
});
