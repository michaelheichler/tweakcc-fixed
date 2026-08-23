import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Prompt {
  id: string;
  version: string;
  pieces: string[];
  identifierMap: Record<string, string>;
}

const promptFiles = (): string[] => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = path.join(repo, 'data', 'prompts');
  return fs
    .readdirSync(dir)
    .filter(name => /^prompts-\d+\.\d+\.\d+\.json$/.test(name))
    .sort((left, right) => {
      const version = (name: string): number[] =>
        name
          .match(/\d+\.\d+\.\d+/)![0]
          .split('.')
          .map(Number);
      const a = version(left);
      const b = version(right);
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    })
    .map(name => path.join(dir, name));
};

describe('prompt data stability', () => {
  it('preserves identifiers when an upstream prompt is unchanged', () => {
    const files = promptFiles();
    const read = (file: string): Prompt[] =>
      JSON.parse(fs.readFileSync(file, 'utf8')).prompts;
    const previous = new Map(
      read(files.at(-2)!).map(prompt => [prompt.id, prompt])
    );
    const changed: string[] = [];

    for (const prompt of read(files.at(-1)!)) {
      const before = previous.get(prompt.id);
      if (
        before?.version === prompt.version &&
        JSON.stringify(before.pieces) === JSON.stringify(prompt.pieces) &&
        JSON.stringify(before.identifierMap) !==
          JSON.stringify(prompt.identifierMap)
      ) {
        changed.push(prompt.id);
      }
    }

    expect(changed).toEqual([]);
  });
});
