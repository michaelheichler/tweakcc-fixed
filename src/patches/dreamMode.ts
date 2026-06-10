// Dream Mode Patch - Force-enable dream (background memory consolidation)
//
// Dream (/dream + auto-dream) is gated behind the statsig dynamic config
// "tengu_onyx_plover". Accounts outside the rollout get null, and the
// fallback gate requires team memory stores with content — so for a solo
// user the feature is invisible even with autoDreamEnabled:true in
// ~/.claude/settings.json.
//
// This patch forces only the AVAILABILITY gate. The on/off decision still
// reads the user's autoDreamEnabled setting (and the Auto-dream TUI
// toggle keeps working), because the enabled-check consults settings
// before falling back to the statsig config.
//
// Availability gate (CC 2.1.170):
// ```diff
//  function HuK(){return j_("tengu_onyx_plover",null)}
//  function nS6(){
// +  return!0;
//    let H=HuK();
//    if(H?.enabled===!0||H?.available===!0)return!0;
//    return aO6()  // team-memory fallback
//  }
// ```

import { debug } from '../utils';
import { showDiff } from './index';

export const writeDreamMode = (file: string): string | null => {
  if (!file.includes('"tengu_onyx_plover"')) {
    debug(
      'patch: dreamMode: availability gate already removed in this CC build — no-op'
    );
    return file;
  }

  const pattern =
    /function [$\w]+\(\)\{return [$\w]+\("tengu_onyx_plover",null\)\}function [$\w]+\(\)\{/;
  const match = file.match(pattern);

  if (!match || match.index === undefined) {
    console.error('patch: dreamMode: failed to find availability gate');
    return null;
  }

  const insertIndex = match.index + match[0].length;

  if (file.startsWith('return!0;', insertIndex)) {
    return file;
  }

  const insertion = 'return!0;';
  const newFile =
    file.slice(0, insertIndex) + insertion + file.slice(insertIndex);

  showDiff(file, newFile, insertion, insertIndex, insertIndex);
  return newFile;
};
