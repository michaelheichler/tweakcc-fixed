// Please see the note about writing patches in ./index
//
// Voice Mode Patch - Force-enable voice mode in Claude Code
//
// The /voice command is gated by `tengu_amber_quartz` (default false) which controls
// both isEnabled() and isHidden for the voice slash command. When enabled, the user
// can hold Space to record audio, which streams to Claude.ai's speech-to-text WebSocket
// and transcribes into the input.
//
// Additionally, `tengu_sotto_voce` gates an "output efficiency" system prompt that makes
// Claude more concise during voice interactions (fitting for spoken input).
//
// Patch 1 - Voice feature gate (tengu_amber_quartz):
// ```diff
//  function qX_() {
// +  return !0;
//    return A9("tengu_amber_quartz", !1);
//  }
// ```
//
// Patch 2 - Voice output efficiency (tengu_sotto_voce):
// ```diff
// -if(A9("tengu_sotto_voce",!1))
// +if(!0)
//    return`# Output efficiency...`
// ```

import { showDiff } from './index';

const insertReturnTrueAt = (file: string, insertIndex: number): string => {
  const insertion = 'return !0;';
  const newFile =
    file.slice(0, insertIndex) + insertion + file.slice(insertIndex);
  showDiff(file, newFile, insertion, insertIndex, insertIndex);
  return newFile;
};

const patchAmberQuartz = (file: string): string | null => {
  // Method 0 (CC >= 2.1.246): `tengu_amber_quartz` is gone. Voice is gated by
  // a tiny ESM module whose unique literal is `"allow_voice_mode"`:
  //   function a(){try{if(!n())return!1;return t()}catch{return!1}}
  //   function c(){return o("allow_voice_mode")}
  //   function p(){return a()&&c()}   // isHidden inverse
  // Force the combined gate (the old isHidden bypass) so /voice stays visible
  // even without OAuth / the permission flag. Older CC never contains this
  // literal next to the combined helper, so this is a no-op there.
  const allowIdx = file.indexOf('"allow_voice_mode"');
  if (allowIdx !== -1) {
    const start = Math.max(0, allowIdx - 800);
    const region = file.slice(start, allowIdx + 400);
    const combined = region.match(
      /function ([$\w]+)\(\)\{return [$\w]+\(\)&&[$\w]+\(\)\}/
    );
    if (combined && combined.index !== undefined) {
      const abs = start + combined.index;
      const brace = file.indexOf('{', abs);
      if (brace !== -1) {
        if (file.startsWith('return !0;', brace + 1)) return file;
        return insertReturnTrueAt(file, brace + 1);
      }
    }
    // Fallback: the slash-command getter itself, so a missing combined helper
    // still un-hides /voice.
    const hidden = file.match(
      /name:"voice",description:"Toggle voice mode"[\s\S]{0,500}?get isHidden\(\)\{return![$\w]+\(\)\}/
    );
    if (hidden && hidden.index !== undefined) {
      const getter = hidden[0].replace(
        /get isHidden\(\)\{return![$\w]+\(\)\}/,
        'get isHidden(){return!1}'
      );
      if (hidden[0] === getter) return file;
      const newFile =
        file.slice(0, hidden.index) +
        getter +
        file.slice(hidden.index + hidden[0].length);
      showDiff(
        file,
        newFile,
        getter,
        hidden.index,
        hidden.index + hidden[0].length
      );
      return newFile;
    }
  }

  // CC <=2.1.69: function XXX(){return YYY("tengu_amber_quartz",!1)}
  const legacyPattern =
    /function [$\w]+\(\)\{return [$\w]+\("tengu_amber_quartz"/;
  const legacyMatch = file.match(legacyPattern);

  if (legacyMatch && legacyMatch.index !== undefined) {
    const insertIndex = legacyMatch.index + legacyMatch[0].indexOf('{') + 1;
    const insertion = 'return !0;';
    const newFile =
      file.slice(0, insertIndex) + insertion + file.slice(insertIndex);
    showDiff(file, newFile, insertion, insertIndex, insertIndex);
    return newFile;
  }

  // CC >=2.1.83: function XXX(){return!YYY("tengu_amber_quartz_disabled",!1)}
  // This returns true by default (flag defaults to false, negated = true).
  // We still force it to always return true in case the flag gets enabled server-side.
  const newPattern =
    /function [$\w]+\(\)\{return![$\w]+\("tengu_amber_quartz_disabled"/;
  const newMatch = file.match(newPattern);

  if (newMatch && newMatch.index !== undefined) {
    const insertIndex = newMatch.index + newMatch[0].indexOf('{') + 1;
    const insertion = 'return !0;';
    const newFile =
      file.slice(0, insertIndex) + insertion + file.slice(insertIndex);
    showDiff(file, newFile, insertion, insertIndex, insertIndex);
    return newFile;
  }

  // CC >=2.1.140: tengu_amber_quartz feature gate removed entirely. The voice slash
  // command now uses two helpers: an always-true `isEnabled` gate and a separate
  // login-aware `isHidden` gate of the form `function XaH(){return Lp6()&&HZ$()}`.
  // We locate the gate function by name via the voice command's `get isHidden()`
  // getter, then force-enable it (which also bypasses the OAuth login requirement).
  const voicePattern =
    /name:"voice",description:"Toggle voice mode"[\s\S]{0,500}?get isHidden\(\)\{return!([$\w]+)\(\)\}/;
  const voiceMatch = file.match(voicePattern);

  if (voiceMatch && voiceMatch.index !== undefined) {
    const funcName = voiceMatch[1];
    const escaped = funcName.replace(/[$]/g, '\\$');
    const funcPattern = new RegExp(`function ${escaped}\\(\\)\\{`);
    const funcMatch = file.match(funcPattern);

    if (funcMatch && funcMatch.index !== undefined) {
      const insertIndex = funcMatch.index + funcMatch[0].length;
      const insertion = 'return !0;';
      const newFile =
        file.slice(0, insertIndex) + insertion + file.slice(insertIndex);
      showDiff(file, newFile, insertion, insertIndex, insertIndex);
      return newFile;
    }
  }

  console.error('patch: voiceMode: failed to find tengu_amber_quartz gate');
  return null;
};

const patchConciseOutput = (file: string): string | null => {
  const pattern = /if\([$\w]+\("tengu_sotto_voce",!1\)\)/;
  const match = file.match(pattern);

  if (!match || match.index === undefined) {
    // CC >=2.1.83: tengu_sotto_voce gate was removed entirely.
    // Concise output may be always-on or handled differently.
    return file;
  }

  const replacement = 'if(!0)';
  const newFile =
    file.slice(0, match.index) +
    replacement +
    file.slice(match.index + match[0].length);

  showDiff(
    file,
    newFile,
    replacement,
    match.index,
    match.index + match[0].length
  );

  return newFile;
};

export const writeVoiceMode = (
  file: string,
  enableConciseOutput: boolean
): string | null => {
  let newFile = patchAmberQuartz(file);
  if (!newFile) return null;

  if (enableConciseOutput) {
    newFile = patchConciseOutput(newFile);
    if (!newFile) return null;
  }

  return newFile;
};
