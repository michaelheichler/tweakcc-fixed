// Please see the note about writing patches in ./index

import { showDiff } from './index';

/**
 * Removes the input box border in Claude Code's PromptInput component.
 *
 * Method 1 (CC >= 2.1.186, jsx() runtime + React-compiler memoization):
 * - The swarmBanner top/bottom rules moved into their own component, reached
 *   through props `{banner,columns,fastModeTag,borderOnly}`. Its horizontal
 *   rules are `"─".repeat(N)` (plus a gradient `jsx(Grad,{count,colors})`
 *   variant and a `"──"` connector); we blank them inside that
 *   component's body only, leaving the banner text and fastMode tag alone.
 * - The main input Box and the external-editor Box no longer carry their own
 *   border props: both spread one hoisted object
 *   `V=lean?{}:{borderColor:(()=>{...})(),borderStyle:"round",borderLeft:!1,
 *   borderRight:!1,borderBottom:!0}`. One edit covers both sites.
 *
 * Methods 2-4 below are the pre-2.1.186 createElement shapes, kept as
 * fallbacks for older CC builds.
 *
 * The PromptInput renders the input area in a ternary:
 *   swarmBanner ? (Fragment with ─.repeat lines using .bgColor) : (Box with borderStyle:"round" and borderText:)
 *
 * There's also an isExternalEditorActive path with borderStyle:"round" and "Save and close editor".
 *
 * We patch:
 * 1. The bgColor ─.repeat top and bottom lines → empty strings
 * 2. The main input Box's borderStyle:"round" → borderStyle:undefined (identified by borderText:)
 * 3. The external editor Box's borderStyle:"round" → borderStyle:undefined (identified by "Save and close editor")
 */
export const writeInputBoxBorder = (
  oldFile: string,
  removeBorder: boolean
): string | null => {
  if (!removeBorder) return oldFile;

  let content = oldFile;
  let patched = false;

  // --- Method 1a: banner rule component (CC >= 2.1.186 jsx runtime) ---
  // function B(P){let M=c(27),{banner:x,columns:y,fastModeTag:z,borderOnly:w}=P;
  //   ... "\u2500".repeat(n) ... "\u2500\u2500" ... g?J.jsx(G,{count:n,colors:g}):""
  const bannerPropsPattern =
    /\{banner:[$\w]+,columns:[$\w]+,fastModeTag:[$\w]+,borderOnly:[$\w]+\}=[$\w]+;/;
  const bannerMatch = content.match(bannerPropsPattern);
  if (bannerMatch && bannerMatch.index !== undefined) {
    // Scope the rewrite to that component's body: from the destructuring up to
    // the next top-level `function ` (the gradient helper that follows it).
    const bodyStart = bannerMatch.index + bannerMatch[0].length;
    const nextFn = content.indexOf('function ', bodyStart);
    const bodyEnd = nextFn === -1 ? bodyStart + 4000 : nextFn;
    const body = content.slice(bodyStart, bodyEnd);
    const newBody = body
      .replace(/"\\u2500"\.repeat\([^)]*\)/g, () => '""')
      .replace(/"\\u2500\\u2500"/g, () => '""')
      .replace(
        /([$\w]+)\?([$\w]+)\.jsx\([$\w]+,\{count:[$\w]+,colors:\1\}\):""/g,
        () => '""'
      );
    if (newBody !== body) {
      content = content.slice(0, bodyStart) + newBody + content.slice(bodyEnd);
      patched = true;
    }
  }

  // --- Method 1b: hoisted border-props object shared by the main input Box
  // and the external editor Box (CC >= 2.1.186) ---
  const hoistedBorderPattern =
    /borderStyle:"round"(,borderLeft:!1,borderRight:!1,borderBottom:!0\})/;
  const hoistedMatch = content.match(hoistedBorderPattern);
  if (hoistedMatch) {
    content = content.replace(
      hoistedBorderPattern,
      (_m, tail: string) => `borderStyle:undefined${tail}`
    );
    patched = true;
  }

  // --- Path 1: swarmBanner branch (─.repeat lines with .bgColor) ---
  // Bottom border: createElement(Text,{color:VAR.bgColor},"─".repeat(VAR))
  const bottomBorderPattern =
    /createElement\(([$\w]+),\{color:([$\w]+)\.bgColor\},"─"\.repeat\(([$\w]+)\)\)/;
  const bottomMatch = content.match(bottomBorderPattern);
  if (bottomMatch) {
    const textComp = bottomMatch[1];
    content = content.replace(
      bottomMatch[0],
      () => `createElement(${textComp},null,"")`
    );

    // Top border: createElement(Text,{color:VAR.bgColor},VAR.text?...Fragment..."─".repeat(...)..."──"):"─".repeat(VAR))
    const topBorderPattern = new RegExp(
      `createElement\\(${textComp},\\{color:${bottomMatch[2]}\\.bgColor\\},${bottomMatch[2]}\\.text\\?.+?"─"\\.repeat\\(${bottomMatch[3]}\\)\\)`
    );
    const topMatch = content.match(topBorderPattern);
    if (topMatch) {
      content = content.replace(
        topMatch[0],
        () => `createElement(${textComp},null,"")`
      );
    }
    patched = true;
  }

  // --- Path 2: Main input Box (else-branch with borderText:) ---
  // Unique identifier: borderColor:VAR(),borderStyle:"round",...,borderText:VAR(...)
  // The borderColor uses a function call like YB() and borderText uses a function call.
  const mainInputPattern =
    /(borderColor:[$\w]+\(\),)borderStyle:"round"(,borderLeft:!1,borderRight:!1,borderBottom:!0,width:"100%",borderText:)/;
  const mainInputMatch = content.match(mainInputPattern);
  if (mainInputMatch) {
    content = content.replace(
      mainInputMatch[0],
      () => `${mainInputMatch[1]}borderStyle:undefined${mainInputMatch[2]}`
    );
    patched = true;
  }

  // --- Path 3: External editor Box ---
  // Unique identifier: borderStyle:"round" near "Save and close editor"
  // Pattern: borderStyle:"round",borderLeft:!1,borderRight:!1,borderBottom:!0,width:"100%"},...,"Save and close editor
  const editorPattern =
    /borderStyle:"round"(,borderLeft:!1,borderRight:!1,borderBottom:!0,width:"100%"\}.+?Save and close editor)/;
  const editorMatch = content.match(editorPattern);
  if (editorMatch) {
    content = content.replace(
      editorMatch[0],
      () => `borderStyle:undefined${editorMatch[1]}`
    );
    patched = true;
  }

  if (patched) {
    showDiff(oldFile, content, '(input border removed)', 0, 0);
    return content;
  }

  console.error('patch: input border: failed to find input border pattern');
  return null;
};
