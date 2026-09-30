import { describe, it, expect } from 'vitest';
import { fatalIn } from './tuiSmoke.mjs';

// Verbatim from the pane captured when CC 2.1.246 died on its first frame:
// patchesAppliedIndication had resolved the Box component as Text, so the
// `┃ ` glyph reached Ink as a bare string child of a layout node. --print,
// apply hygiene and the four-zeros gate were all green at the time.
const CRASH_PANE = [
  '  ERROR  Text string "┃ " must be rendered inside <Text> component (owner chain: _n > $x > _n > $x)',
  '',
  ' /$bunfs/root/_488.js:26:32312',
  '',
  ' - createTextInstance (/$bunfs/root/_488.js:26:32312)',
  '',
  'Claude Code exited after an unrecoverable interface error (Text string "┃ " must be rendered inside <Text> component).',
  '[EXIT=1]',
].join('\n');

const HEALTHY_PANE = [
  '⏺ Fixed: hello.py:2 now returns a + b.',
  '',
  '❯ ',
  '  Opus 5 (1M context) 1M | 5%',
  '  tui-test | master | 25s',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
].join('\n');

describe('tuiSmoke fatal detection', () => {
  it('trips on the recorded Ink interface crash', () => {
    expect(fatalIn(CRASH_PANE)).toBeTruthy();
  });

  it('stays quiet on a healthy composer pane', () => {
    expect(fatalIn(HEALTHY_PANE)).toBeNull();
  });

  it('trips on the bare Ink message even without the exit banner', () => {
    expect(
      fatalIn('some output\nText string "x" must be rendered inside <Text> component\n')
    ).toBeTruthy();
  });
});
