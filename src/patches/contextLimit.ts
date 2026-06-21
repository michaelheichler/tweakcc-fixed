// Please see the note about writing patches in ./index

const OVERRIDE = '(+process.env.CLAUDE_CODE_CONTEXT_LIMIT||200000)';

export const writeContextLimit = (oldFile: string): string | null => {
  // CC >= ~2.1.18x split the single 200000 context-limit constant into TWO
  // adjacent ones: `var fkt=200000,KQ=200000,Akt=20000,MWu=32000,NWu=128000;`.
  //   - the 2nd (`KQ`) is the context window — used as `configured: KQ,
  //     source: "model-default"` and in the `vti(...) > KQ` exceeds-check;
  //   - the 1st (`fkt`) is the per-model token limit feeding `o = floor(fkt*n)`,
  //     and the effective window is `min(o, KQ)`.
  // Because the window is `min(o-from-fkt, KQ)`, RAISING the limit requires
  // overriding BOTH (overriding only one leaves the window capped by the other).
  // Env-unset → both stay 200000 → identical to stock CC.
  const patternTwo =
    /var ([\w$]+)=200000,([\w$]+)=200000,([\w$]+)=20000,([\w$]+)=32000,([\w$]+)=(128000|64000);/;
  const matchTwo = oldFile.match(patternTwo);
  if (matchTwo) {
    return oldFile.replace(
      patternTwo,
      `var ${matchTwo[1]}=${OVERRIDE},${matchTwo[2]}=${OVERRIDE},${matchTwo[3]}=20000,${matchTwo[4]}=32000,${matchTwo[5]}=${matchTwo[6]};`
    );
  }

  // Older CC (a single 200000 constant): keep the original behavior.
  const patternOne =
    /var ([\w$]+)=200000,([\w$]+)=20000,([\w$]+)=32000,([\w$]+)=(128000|64000);/;
  const matchOne = oldFile.match(patternOne);
  if (matchOne) {
    return oldFile.replace(
      patternOne,
      `var ${matchOne[1]}=${OVERRIDE},${matchOne[2]}=20000,${matchOne[3]}=32000,${matchOne[4]}=${matchOne[5]};`
    );
  }

  console.error('patch: contextLimit: failed to find context limit constants');
  return null;
};
