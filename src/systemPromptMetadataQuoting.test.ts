import { describe, expect, it } from 'vitest';
import {
  generateMarkdownFromPrompt,
  parseMarkdownPrompt,
  stringifyPromptMarkdown,
} from './systemPromptMarkdown';
import type { StringsPrompt } from './systemPromptMarkdown';

const metadata = {
  name: 'Riley\'s "review" prompt',
  description:
    'Direct task instructions.\nKeep the blank line below.\n\nThen continue.',
  ccVersion: '2.1.322',
};

const stockPrompt: StringsPrompt = {
  name: 'Stock prompt',
  id: 'stock-prompt',
  description: 'Prompt used when no custom body exists.',
  pieces: ['Stock body.'],
  identifiers: [],
  identifierMap: {},
  version: '2.1.322',
};

describe('system prompt metadata round trips', () => {
  it.each([1, 2, 4])(
    'preserves quoted metadata and body after %i rewrites',
    rewriteCount => {
      let markdown = stringifyPromptMarkdown(
        'First paragraph.\n\nSecond paragraph.',
        metadata
      );

      for (let rewrite = 0; rewrite < rewriteCount; rewrite++) {
        const parsed = parseMarkdownPrompt(markdown);
        markdown = stringifyPromptMarkdown(parsed.content, {
          name: parsed.name,
          description: parsed.description,
          ccVersion: parsed.ccVersion,
        });
      }

      const result = parseMarkdownPrompt(markdown);
      expect({
        name: result.name,
        description: result.description,
        ccVersion: result.ccVersion,
      }).toEqual(metadata);
      expect(result.content).toBe('First paragraph.\n\nSecond paragraph.\n');
      const canonicalDescription = 'Direct task instructions.';
      const canonicalHeader = stringifyPromptMarkdown('', {
        name: result.name,
        description: canonicalDescription,
        ccVersion: result.ccVersion,
      });
      const canonicalNameLine = canonicalHeader
        .split('\n')
        .find(line => line.startsWith('name:'));
      expect(canonicalNameLine).toMatch(/^name: ".*"$/);
      expect(canonicalHeader).toContain(
        `description: "${canonicalDescription}"`
      );
      expect(canonicalHeader).toContain(`ccVersion: "${result.ccVersion}"`);
    }
  );

  it('keeps an intentionally empty body empty after rewriting', () => {
    const markdown = stringifyPromptMarkdown('', metadata);
    const parsed = parseMarkdownPrompt(markdown);
    const rewritten = stringifyPromptMarkdown(parsed.content, {
      name: parsed.name,
      description: parsed.description,
      ccVersion: parsed.ccVersion,
    });

    expect(parseMarkdownPrompt(rewritten).content.trim()).toBe('');
  });

  it('keeps an intentionally empty custom body empty', () => {
    const markdown = generateMarkdownFromPrompt(stockPrompt, '');

    expect(parseMarkdownPrompt(markdown).content.trim()).toBe('');
  });

  it('uses the stock body when no custom body is provided', () => {
    const markdown = generateMarkdownFromPrompt(stockPrompt);

    expect(parseMarkdownPrompt(markdown).content.trim()).toBe('Stock body.');
  });

  it('retains a provided custom body', () => {
    const markdown = generateMarkdownFromPrompt(stockPrompt, 'Custom body.');

    expect(parseMarkdownPrompt(markdown).content.trim()).toBe('Custom body.');
  });
});
