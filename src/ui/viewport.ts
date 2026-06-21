/**
 * Compute the slice bounds for a "centered" scroll viewport: keep the selected
 * row near the middle of a window of at most `maxVisible` rows, clamped so the
 * window never runs past either end of the list. Returns the absolute
 * `[start, end)` indices to `slice()` the list with.
 *
 * Pure and shared by the list views (ClaudeMdAltNames, ThinkingVerbs,
 * ThinkingStyle phases/presets) so the math lives — and is tested — in one
 * place. A plain function rather than a hook: it has no state/effects, so it
 * needs no React-hook rules and is trivially unit-testable.
 */
export function getCenteredViewportSlice(
  selectedIndex: number,
  length: number,
  maxVisible: number
): { start: number; end: number } {
  const startIndex = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
  const end = Math.min(length, startIndex + maxVisible);
  const start = Math.max(0, end - maxVisible);
  return { start, end };
}
