import { describe, expect, it } from 'vitest';
import { writeDreamMode } from './dreamMode';

const GATE =
  'function HuK(){return j_("tengu_onyx_plover",null)}function nS6(){let H=HuK();if(H?.enabled===!0||H?.available===!0)return!0;return aO6()}';

describe('writeDreamMode', () => {
  it('inserts return!0; at the start of the availability gate body', () => {
    const file = `before;${GATE}after;`;
    const result = writeDreamMode(file);
    expect(result).toContain(
      '"tengu_onyx_plover",null)}function nS6(){return!0;let H=HuK();'
    );
  });

  it('tolerates minifier-renamed identifiers including $', () => {
    const file =
      'function $a1(){return $b2("tengu_onyx_plover",null)}function $c3(){let q=$a1();if(q?.enabled===!0||q?.available===!0)return!0;return $d4()}';
    const result = writeDreamMode(file);
    expect(result).toContain('}function $c3(){return!0;let q=$a1();');
  });

  it('is idempotent on already-patched input', () => {
    const patched = writeDreamMode(`x;${GATE}y;`);
    expect(patched).not.toBeNull();
    expect(writeDreamMode(patched!)).toBe(patched);
  });

  it('no-ops when the flag literal is gone (feature promoted)', () => {
    const file = 'function nS6(){return aO6()}';
    expect(writeDreamMode(file)).toBe(file);
  });

  it('fails loud when the flag exists but the shape changed', () => {
    const file = 'let x="tengu_onyx_plover";somethingElse();';
    expect(writeDreamMode(file)).toBeNull();
  });
});
