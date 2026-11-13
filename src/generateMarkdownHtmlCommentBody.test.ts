import { describe, it, expect } from 'vitest';
import matter from 'gray-matter';
import {
  generateMarkdownFromPrompt,
  stringifyPromptMarkdown,
  type StringsPrompt,
} from './systemPromptSync';

const OPTS = { delimiters: ['<!--', '-->'] as [string, string] };

const promptWith = (pieces: string[]): StringsPrompt =>
  ({
    id: 'skill-artifact-report-html-template',
    name: 'Skill: Artifact report HTML template',
    description: 'Model-facing template.html scaffold for the report artifact.',
    version: '2.1.206',
    pieces,
    identifiers: [],
    identifierMap: {},
  }) as unknown as StringsPrompt;

describe('generateMarkdownFromPrompt with an HTML-comment body', () => {
  const body =
    '<!-- Artifact-tool body fragment — no <!DOCTYPE> wrapper. -->\n' +
    '<title>Report</title>\n' +
    '<!-- SLOT: masthead -->\n';

  it('does not throw when the body starts with the front-matter delimiter', () => {
    expect(() => generateMarkdownFromPrompt(promptWith([body]))).not.toThrow();
  });

  it('round-trips: front-matter parses and the body survives verbatim', () => {
    const md = generateMarkdownFromPrompt(promptWith([body]));
    const parsed = matter(md, OPTS);
    expect(parsed.data.name).toBe('Skill: Artifact report HTML template');
    expect(parsed.data.ccVersion).toBe('2.1.206');
    expect(parsed.content.trim()).toBe(body.trim());
  });

  it('preserves parsed metadata and body for an ordinary body', () => {
    const plain = 'Just a normal prompt body.';
    const prompt = promptWith([plain]);
    const parsed = matter(generateMarkdownFromPrompt(prompt), OPTS);

    expect(parsed.data).toEqual({
      name: prompt.name,
      description: prompt.description,
      ccVersion: prompt.version,
    });
    expect(parsed.content.trim()).toBe(plain);
  });

  it('re-stringifies an already-written HTML-comment body without throwing', () => {
    const md = generateMarkdownFromPrompt(promptWith([body]));
    const parsed = matter(md, OPTS);
    expect(() =>
      stringifyPromptMarkdown(parsed.content, {
        ...parsed.data,
        variables: ['A', 'B'],
      })
    ).not.toThrow();
    const round = matter(
      stringifyPromptMarkdown(parsed.content, {
        ...parsed.data,
        variables: ['A', 'B'],
      }),
      OPTS
    );
    expect(round.data.variables).toEqual(['A', 'B']);
    expect(round.content.trim()).toBe(body.trim());
  });

  it.each([
    { body: 'BODY', expectedBody: 'BODY\n' },
    { body: 'BODY\n', expectedBody: 'BODY\n' },
    { body: 'BODY\n\n', expectedBody: 'BODY\n\n' },
    { body: '\nBODY', expectedBody: '\nBODY\n' },
    { body: '', expectedBody: '\n' },
  ])('preserves parsed body newlines for $body', ({ body, expectedBody }) => {
    const data = { name: 'N', description: 'D', ccVersion: '1.0.0' };
    const parsed = matter(stringifyPromptMarkdown(body, data), OPTS);

    expect(parsed.content).toBe(expectedBody);
  });
});
