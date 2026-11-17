import { MutableText } from './mutableText';
import {
  foldPromptMatchContent,
  PromptPieceMatcherCatalog,
  PromptMatchSpec,
} from './systemPromptPieceMatcher';
import { encodeReplacementForDelimiter } from './systemPromptSync';
import {
  changedSpan,
  detachedSlice,
  OffsetMapper,
  selectSpliceSiteAt,
  Span,
  SpanClaim,
} from './systemPromptSites';
import { BundleRegions, matchesInRegion } from './virtualBundle';

export interface PromptReplayPlan {
  claim: SpanClaim;
  regex: string;
  spec: PromptMatchSpec;
  order: number;
  groupMultiplicity?: number;
  priorCanonicalSites?: number;
  getInterpolatedContent: (match: RegExpMatchArray) => string;
  shouldSkip?: (interpolatedContent: string, delimiter: string) => boolean;
  asset?: boolean;
}

export interface PromptReplayMutation {
  claim: SpanClaim;
  source: SpanClaim;
  regex: string;
  order: number;
}

export interface PromptReplayResult {
  content: string;
  landed: Map<SpanClaim, boolean>;
  destinations: Map<SpanClaim, { start: number; end: number }>;
  replacements: Map<SpanClaim, string>;
  delimiters: Map<SpanClaim, string>;
  mutations: PromptReplayMutation[];
}

type ReplayOutput = Omit<PromptReplayResult, 'content'>;

interface ReplayState {
  working: MutableText;
  regions: BundleRegions | null;
  catalog: PromptPieceMatcherCatalog;
  mapper: OffsetMapper;
  escapeNonAscii: boolean;
  output: ReplayOutput;
}

const spliceReplaySite = (
  state: ReplayState,
  plan: PromptReplayPlan,
  span: Span,
  replacement: string
): void => {
  const { working, regions, catalog, mapper, output } = state;
  const claim: SpanClaim = {
    ...plan.claim,
    ...mapper.spanToPristine(span),
    mutates: true,
    replacement,
  };
  const replacementEnd = span.start + replacement.length;
  const delta = replacementEnd - span.end;
  for (const destination of output.destinations.values()) {
    if (destination.end <= span.start) continue;
    if (destination.start >= span.end) {
      destination.start += delta;
      destination.end += delta;
      continue;
    }
    destination.start = Math.min(destination.start, span.start);
    destination.end = Math.max(destination.end + delta, replacementEnd);
  }
  working.splice(span.start, span.end, replacement);
  regions?.recordSplice(span.start, span.end, replacement.length);
  mapper.record(span, replacement.length);
  catalog.recordSplice(working, {
    start: span.start,
    end: span.end,
    replacementLength: replacement.length,
  });
  output.destinations.set(plan.claim, {
    start: span.start,
    end: replacementEnd,
  });
  output.mutations.push({
    claim,
    source: plan.claim,
    regex: plan.regex,
    order: plan.order,
  });
};

const replayMatchedPrompt = (
  state: ReplayState,
  plan: PromptReplayPlan,
  match: RegExpMatchArray,
  start: number
): boolean => {
  const { working, output, escapeNonAscii } = state;
  const span = { start, end: start + match[0].length };
  const delimiter = working.charAt(start - 1);
  const interpolated = plan.getInterpolatedContent(match);
  const encoded = plan.shouldSkip?.(interpolated, delimiter)
    ? null
    : encodeReplacementForDelimiter(interpolated, delimiter, escapeNonAscii);
  if (!encoded || encoded.incomplete) {
    output.landed.set(plan.claim, false);
    return false;
  }
  output.landed.set(plan.claim, true);
  output.replacements.set(plan.claim, encoded.content);
  output.delimiters.set(plan.claim, delimiter);
  if (encoded.content === match[0]) {
    output.destinations.set(plan.claim, span);
    return false;
  }
  spliceReplaySite(state, plan, span, encoded.content);
  return true;
};

export const replayPromptPlans = async (
  content: string,
  mapper: OffsetMapper,
  plans: PromptReplayPlan[],
  escapeNonAscii: boolean
): Promise<PromptReplayResult> => {
  const working = new MutableText(content);
  const regions = BundleRegions.of(content);
  const siteKey = (plan: PromptReplayPlan): string =>
    (plan.asset ? 'asset:' : 'js:') + plan.regex;
  const catalog = new PromptPieceMatcherCatalog([
    ...new Map(plans.map(plan => [plan.regex, plan.spec])).values(),
  ]);
  if (plans.length > 0) catalog.index(content, foldPromptMatchContent(content));
  const output: ReplayOutput = {
    landed: new Map(),
    destinations: new Map(),
    replacements: new Map(),
    delimiters: new Map(),
    mutations: [],
  };
  const state = { working, regions, catalog, mapper, escapeNonAscii, output };
  const orderedPlans = [...plans].sort((a, b) => a.order - b.order);
  const lastUse = new Map<string, number>();
  orderedPlans.forEach((plan, index) => lastUse.set(plan.regex, index));
  const expiring = new Map<number, string[]>();
  for (const [regex, index] of lastUse) {
    const regexes = expiring.get(index);
    if (regexes) regexes.push(regex);
    else expiring.set(index, [regex]);
  }
  const planMultiplicity = new Map<string, number>();
  for (const plan of orderedPlans) {
    const key = siteKey(plan);
    planMultiplicity.set(key, (planMultiplicity.get(key) ?? 0) + 1);
  }
  const planRetained = new Map<string, number>();
  const planSpliced = new Map<string, number>();

  for (const [planIndex, plan] of orderedPlans.entries()) {
    for (const expired of expiring.get(planIndex - 1) ?? []) {
      catalog.delete(expired);
    }
    const matches = matchesInRegion(
      await catalog.matchCurrent(plan.regex, working),
      regions,
      Boolean(plan.asset)
    );
    const key = siteKey(plan);
    const retained = planRetained.get(key) ?? 0;
    const remaining =
      (plan.groupMultiplicity ?? planMultiplicity.get(key) ?? 1) -
      (planSpliced.get(key) ?? 0);
    const { match } = selectSpliceSiteAt(
      matches,
      remaining,
      retained + (plan.priorCanonicalSites ?? 0),
      index => working.charAt(index)
    );
    if (!match || match.index === undefined) {
      output.landed.set(plan.claim, false);
      continue;
    }
    const counts = replayMatchedPrompt(state, plan, match, match.index)
      ? planSpliced
      : planRetained;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    content: working.toString(),
    ...output,
  };
};

export const surfaceClaim = (
  working: string,
  next: string,
  mapper: OffsetMapper,
  surface: SpanClaim['surface'],
  id: string,
  body: string
): SpanClaim | null => {
  const span = changedSpan(working, next);
  if (!span) return null;
  const newLen = span.end - span.start + (next.length - working.length);
  const claim: SpanClaim = {
    ...mapper.spanToPristine(span),
    surface,
    id,
    site: 0,
    mutates: true,
    body,
    delimiter: '',
    replacement: detachedSlice(next, span.start, span.start + newLen),
  };
  mapper.record(span, newLen);
  return claim;
};
