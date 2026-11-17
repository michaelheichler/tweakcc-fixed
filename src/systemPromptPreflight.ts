/**
 * Apply preflight for system-prompt overrides.
 *
 * ONE implementation, two entry points: `--validate-system-prompts` runs it as
 * a dry run, and `applyCustomization` runs it against the pristine binary
 * before its first mutation. Authors therefore get the same verdict the apply
 * will reach, and every check resolves through the SAME code the apply uses
 * (site resolution, delimiter, replacement encoding, inline-blob walkers,
 * reminder injectors) rather than a parallel re-derivation.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import matter from 'gray-matter';

import { SYSTEM_PROMPTS_DIR, SYSTEM_REMINDERS_DIR } from './config';
import { canonicalPromptEntries } from './systemPromptCatalogue';
import {
  findAllPromptPieceMatchesBatch,
  foldPromptMatchContent,
} from './systemPromptPieceMatcher';
import {
  encodeReplacementForDelimiter,
  loadSystemPromptsWithRegex,
  needsDelimiterAwareEscaping,
  pristineBodiesById,
} from './systemPromptSync';
import {
  bodyCarriedBy,
  delimiterBefore,
  detectUnicodeEscaping,
  extractBuildTime,
  introducedRawNonAscii,
  leakedPromptPlaceholders,
  lintBacktickEscapes,
  literalProbeWindows,
  OffsetMapper,
  presentLiterals,
  resolveCandidateSites,
  spanConflicts,
  SpanClaim,
} from './systemPromptSites';
import {
  applyInlineBlobOverrides,
  type WrittenRegion,
} from './patches/inlineBlobOverrides';
import { textAssetVisible } from './nativeTextAssets';
import { BundleRegions, matchesInRegion } from './virtualBundle';
import { REMINDER_REGISTRY } from './patches/systemReminderOverrides';
import {
  loadReminderOverride,
  substitutePlaceholders,
} from './systemReminderSync';
import {
  replayPromptPlans,
  surfaceClaim,
  type PromptReplayPlan,
} from './systemPromptPreflightReplay';

export { replayPromptPlans, surfaceClaim } from './systemPromptPreflightReplay';
export type {
  PromptReplayMutation,
  PromptReplayPlan,
  PromptReplayResult,
} from './systemPromptPreflightReplay';

export type PreflightCheck =
  | 'cardinality'
  | 'ownership'
  | 'backtick-escape'
  | 'raw-non-ascii';

export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface PreflightFinding {
  check: PreflightCheck;
  severity: PreflightSeverity;
  /** Prompt id, inline-blob filename, or reminder id. */
  id: string;
  /** 0-based ordinal among the binary sites this id occupies. */
  site: number;
  /** 1-based line within the override file, when the finding has one. */
  line?: number;
  lineText?: string;
  offending?: string;
  required?: string;
  message: string;
}

export interface PreflightResult {
  version: string;
  promptsChecked: number;
  sitesChecked: number;
  findings: PreflightFinding[];
}

/**
 * Owner id -> ids it declares it shadows. `loadShadowSet` flattens this to "is
 * shadowed by someone", which cannot answer "may THIS override overlap THAT
 * one", so the ownership check reads the frontmatter itself.
 */
export const loadShadowDeclarations = async (): Promise<
  Map<string, Set<string>>
> => {
  const out = new Map<string, Set<string>>();
  const record = (owner: string, ids: unknown): void => {
    if (!Array.isArray(ids)) return;
    let set = out.get(owner);
    if (!set) {
      set = new Set<string>();
      out.set(owner, set);
    }
    for (const id of ids) {
      if (typeof id === 'string' && id) set.add(id);
    }
  };

  for (const dir of [SYSTEM_PROMPTS_DIR, SYSTEM_REMINDERS_DIR]) {
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith('.md')) continue;
      let text: string;
      try {
        text = await fs.readFile(path.join(dir, name), 'utf8');
      } catch {
        continue;
      }
      let data: Record<string, unknown>;
      try {
        data = matter(text, { delimiters: ['<!--', '-->'] }).data;
      } catch {
        continue;
      }
      // An override is addressable by both its id and its filename: named
      // prompts claim spans under the id, inline blobs under the filename.
      record(name.slice(0, -3), data.shadows);
      record(name, data.shadows);
    }
  }
  for (const injection of REMINDER_REGISTRY) {
    record(injection.id, injection.shadows);
  }
  return out;
};

interface PromptLanding extends PromptReplayPlan {
  sites: Array<{ start: number; end: number }>;
}

const PROBE_RUN_MIN_LENGTH = 25;
const PROBE_RUN_MAX_LENGTH = 160;

interface SurfaceClaims {
  claims: SpanClaim[];
  content: string;
  mapper: OffsetMapper;
}

const claimOverrideSurfaces = async (
  pristine: string
): Promise<SurfaceClaims> => {
  const claims: SpanClaim[] = [];
  const mapper = new OffsetMapper();
  let working = pristine;

  const record = (
    surface: SpanClaim['surface'],
    id: string,
    body: string,
    next: string
  ): void => {
    const claim = surfaceClaim(working, next, mapper, surface, id, body);
    // No change means the anchor did not resolve, or the override is a pristine
    // passthrough. Neither takes ownership of bytes away from anyone.
    if (!claim) return;
    claims.push(claim);
    working = next;
  };

  let files: string[] = [];
  try {
    files = await fs.readdir(SYSTEM_PROMPTS_DIR);
  } catch {
    files = [];
  }
  const written: WrittenRegion[] = [];
  for (const filename of files
    .filter(n => n.startsWith('inline-') && n.endsWith('.md'))
    .sort()) {
    const { content } = await applyInlineBlobOverrides(working, {
      only: filename,
      written,
    });
    let body = '';
    try {
      const raw = await fs.readFile(
        path.join(SYSTEM_PROMPTS_DIR, filename),
        'utf8'
      );
      body = matter(raw, { delimiters: ['<!--', '-->'] }).content;
    } catch {
      body = '';
    }
    record('inline-blob', filename, body, content);
  }

  for (const injection of REMINDER_REGISTRY) {
    const override = await loadReminderOverride(injection.id);
    // A missing file is what `--apply` seeds from the default body, so measure
    // the same span rather than skipping the reminder.
    const body = override ? override.body : injection.defaultBody;
    const isSuppressed = override ? override.isSuppressed : false;
    const { result, errors } = substitutePlaceholders(
      body,
      injection.placeholders
    );
    if (errors.length > 0) continue;
    let next: string | null = null;
    try {
      next = injection.apply(working, result, isSuppressed);
    } catch {
      next = null;
    }
    if (next === null) continue;
    record('reminder', injection.id, body, next);
  }

  return { claims, content: working, mapper };
};

const dedupe = (findings: PreflightFinding[]): PreflightFinding[] => {
  const seen = new Set<string>();
  const out: PreflightFinding[] = [];
  for (const f of findings) {
    const key = [
      f.check,
      f.id,
      f.line ?? '',
      f.offending ?? '',
      f.message,
    ].join('\x00');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
};

export interface PreflightInput {
  /** cli.js as it is BEFORE any override splicing. */
  pristine: string;
  version: string;
  patchFilter?: string[] | null;
}

export const runSystemPromptPreflight = async ({
  pristine,
  version,
  patchFilter,
}: PreflightInput): Promise<PreflightResult> => {
  const findings: PreflightFinding[] = [];
  const escapeNonAscii = detectUnicodeEscaping(pristine);
  const buildTime = extractBuildTime(pristine);

  // A `.zst` asset this Node cannot decode is not in the bundle; the apply
  // skips its prompts too (see applySystemPrompts).
  const loaded = await loadSystemPromptsWithRegex(
    version,
    escapeNonAscii,
    buildTime
  );
  const prompts = loaded.filter(entry => textAssetVisible(entry.asset));
  // No prompt data preloaded for this version: the apply will skip system
  // prompts entirely, so there is nothing to validate. The CLI turns this into
  // a hard failure — a dry run that saw no input must never read as clean —
  // while the apply just carries on.
  if (prompts.length === 0) {
    return { version, promptsChecked: 0, sitesChecked: 0, findings: [] };
  }
  const canonicalEntries = canonicalPromptEntries(loaded);
  const bodiesById = await pristineBodiesById(version);
  const groupNames = new Map<string, Set<string>>();
  for (const entry of prompts) {
    const names = groupNames.get(entry.promptId) ?? new Set<string>();
    for (const name of Object.values(entry.identifierMap)) names.add(name);
    groupNames.set(entry.promptId, names);
  }

  // Catalogue entries that share a content shape share a candidate set: the
  // apply consumes them sequentially, one site per entry. Group by the search
  // regex so cardinality is measured per shape, never deduped by id — same-id
  // multi-site prompts are normal and load-bearing.
  const groups = new Map<
    string,
    Array<{ order: number; entry: (typeof prompts)[number] }>
  >();
  // Keyed by region as well: an asset entry only ever lands inside its own
  // text asset and a JS entry only in JS (see BundleRegions), so the two never
  // share a candidate set even when their text is identical.
  prompts.forEach((entry, order) => {
    if (patchFilter && !patchFilter.includes(entry.promptId)) return;
    const key = (entry.asset ? 'asset:' : 'js:') + entry.regex;
    const group = groups.get(key);
    if (group) group.push({ order, entry });
    else groups.set(key, [{ order, entry }]);
  });
  for (const [key, entries] of groups) {
    if (entries.every(({ entry }) => canonicalEntries.has(entry))) {
      groups.delete(key);
    }
  }
  const pristineRegions = BundleRegions.of(pristine);

  const promptLandings: PromptLanding[] = [];
  let sitesChecked = 0;
  const groupMatches = await findAllPromptPieceMatchesBatch(
    [
      ...new Map(
        [...groups.values()].map(([{ entry }]) => [
          entry.regex,
          { regex: entry.regex, pieces: entry.pieces, version, buildTime },
        ])
      ).values(),
    ],
    pristine,
    foldPromptMatchContent(pristine)
  );

  for (const entries of groups.values()) {
    const { regex, asset } = entries[0].entry;
    const multiplicity = entries.length;
    const matches = matchesInRegion(
      groupMatches.get(regex) ?? [],
      pristineRegions,
      Boolean(asset)
    );
    const resolved = resolveCandidateSites(pristine, matches, multiplicity);
    // More sites than entries with no way to tell which are ours: the apply
    // refuses to splice at all (selectSpliceSiteAt), so claiming spans here
    // would lint bytes nothing is going to touch.
    const candidates =
      matches.length > multiplicity && resolved.length !== multiplicity
        ? []
        : resolved;
    const landingSites = candidates.flatMap(match =>
      match.index === undefined
        ? []
        : [
            {
              start: match.index,
              end: match.index + match[0].length,
            },
          ]
    );

    if (resolved.length !== multiplicity) {
      const ids = [...new Set(entries.map(e => e.entry.promptId))].join(', ');
      findings.push({
        check: 'cardinality',
        severity: 'warning',
        id: entries[0].entry.promptId,
        site: 0,
        message:
          `${resolved.length} candidate site(s) in cli.js for ` +
          `${multiplicity} catalogue entr${multiplicity === 1 ? 'y' : 'ies'} ` +
          `(${ids}) — the apply consumes one site per entry, so this ` +
          (resolved.length < multiplicity
            ? 'leaves entries with no site to splice'
            : 'is ambiguous and the apply will skip it rather than splice ' +
              'into whichever site came first'),
      });
    }

    let priorCanonicalSites = 0;
    for (let site = 0; site < entries.length; site++) {
      const { order, entry } = entries[site];
      const match = candidates[site];
      const canonical = canonicalEntries.has(entry);
      if (canonical) priorCanonicalSites++;
      if (!match || match.index === undefined) continue;
      sitesChecked++;
      if (canonical) continue;

      const delimiter = delimiterBefore(pristine, match.index);
      const body = entry.prompt.content;

      // Check 4 — delimiter-aware backtick lint, at the RESOLVED site with the
      // delimiter the resolution already determined. Quoted sites double every
      // backslash on the way in, so the same bytes are correct there.
      if (delimiter === '`') {
        for (const lint of lintBacktickEscapes(body)) {
          findings.push({
            check: 'backtick-escape',
            severity: lint.kind === 'lossy' ? 'error' : 'warning',
            id: entry.promptId,
            site,
            line: entry.prompt.contentLineOffset + lint.line,
            lineText: lint.lineText,
            offending: lint.offending,
            required: lint.required,
            message:
              lint.kind === 'lossy'
                ? `\`${lint.offending}\` at a backtick site is consumed by ` +
                  `the template literal (\`\\s\` cooks to \`s\`, ` +
                  `\`[\\s\\S]\` to \`[sS]\`) — write \`${lint.required}\` ` +
                  'for a literal backslash'
                : `\`${lint.offending}\` at a backtick site is a redundant ` +
                  'escape: the backslash is dropped and the quote renders as ' +
                  'written. Drop the backslash, or double it to keep one',
          });
        }
      }

      const interpolatedContent = entry.getInterpolatedContent(match);
      const shouldSkip = (content: string, siteDelimiter: string): boolean => {
        if (
          siteDelimiter !== '"' &&
          siteDelimiter !== "'" &&
          siteDelimiter !== '`' &&
          needsDelimiterAwareEscaping(content)
        ) {
          return true;
        }
        const leaked = leakedPromptPlaceholders(content, entry.prompt.content);
        const ownNames = new Set(Object.values(entry.identifierMap));
        const siblingNames = groupNames.get(entry.promptId);
        const siblingShape =
          leaked.length > 0 &&
          leaked.every(name => !ownNames.has(name) && siblingNames?.has(name));
        // Mirror of the apply: a survivor skips the site in EVERY delimiter,
        // except a literal the pristine span itself carries.
        const drifted =
          siteDelimiter === '`'
            ? leaked
            : leaked.filter(
                name =>
                  !new RegExp(
                    '(?<!\\\\)\\$\\{' + name + '(?![A-Za-z0-9_])'
                  ).test(match[0])
              );
        return siblingShape || drifted.length > 0;
      };
      const encoded = encodeReplacementForDelimiter(
        interpolatedContent,
        delimiter,
        escapeNonAscii
      );
      const pristineSite = pristine.slice(
        match.index,
        match.index + match[0].length
      );

      // Check 5 — raw non-ASCII the splice would introduce. Compared against
      // the canonical pristine body rather than the encoded site, so a
      // codepoint Anthropic already ships is never reported.
      const pristineBodies = bodiesById.get(entry.promptId);
      const pristineText = pristineBodies
        ? [...pristineBodies].join('\n')
        : pristineSite;
      const introduced = introducedRawNonAscii(pristineText, encoded.content);
      if (introduced.length > 0) {
        findings.push({
          check: 'raw-non-ascii',
          severity: 'error',
          id: entry.promptId,
          site,
          offending: introduced.join(' '),
          message:
            `would introduce raw non-ASCII ${introduced.join(' ')} the ` +
            'pristine text does not carry — Bun stores modules as Latin-1, so ' +
            'raw bytes mojibake; emit \\uXXXX instead',
        });
      }

      const claim: SpanClaim = {
        start: match.index,
        end: match.index + match[0].length,
        surface: 'prompt',
        id: entry.promptId,
        site,
        mutates:
          !shouldSkip(interpolatedContent, delimiter) &&
          encoded.content !== pristineSite,
        body,
        delimiter,
        replacement: encoded.content,
      };
      promptLandings.push({
        claim,
        regex,
        spec: { regex, pieces: entry.pieces, version, buildTime },
        sites: landingSites,
        order,
        groupMultiplicity: multiplicity,
        priorCanonicalSites,
        getInterpolatedContent: entry.getInterpolatedContent,
        shouldSkip,
        asset: Boolean(entry.asset),
      });
    }
  }

  const surfaces = await claimOverrideSurfaces(pristine);
  const replayPlans = promptLandings.sort((a, b) => a.order - b.order);
  const claims = [...surfaces.claims, ...replayPlans.map(plan => plan.claim)];
  const replay = await replayPromptPlans(
    surfaces.content,
    surfaces.mapper,
    replayPlans,
    escapeNonAscii
  );

  const shadowDeclarations = await loadShadowDeclarations();
  const shadowedBy = (owner: string, victim: string): boolean =>
    shadowDeclarations.get(owner)?.has(victim) ?? false;
  const directOwners = new Map(
    spanConflicts(claims, shadowedBy).map(conflict => [
      conflict.claim,
      conflict.owner,
    ])
  );
  const surfaceMutations = surfaces.claims.map((claim, index) => ({
    claim,
    source: claim,
    regex: '',
    order: index - surfaces.claims.length,
  }));
  const mutations = [...surfaceMutations, ...replay.mutations];
  const candidates = replayPlans.flatMap(plan => {
    if (!plan.claim.mutates) return [];
    const physicalOwner = directOwners.get(plan.claim);
    if (physicalOwner) {
      return [{ claim: plan.claim, owner: physicalOwner, direct: true }];
    }
    if (replay.landed.get(plan.claim) !== false) return [];
    const eligible = mutations.filter(mutation => {
      if (
        mutation.order >= plan.order ||
        mutation.regex === plan.regex ||
        mutation.claim.id === plan.claim.id ||
        shadowedBy(mutation.claim.id, plan.claim.id) ||
        shadowedBy(plan.claim.id, mutation.claim.id)
      ) {
        return false;
      }
      return true;
    });
    const shifted = eligible.find(mutation =>
      plan.sites.some(
        site =>
          (mutation.claim.start < site.end &&
            site.start < mutation.claim.end) ||
          (mutation.source.start < site.end && site.start < mutation.source.end)
      )
    );
    if (shifted && bodyCarriedBy(plan.claim.body, shifted.claim.body))
      return [];
    return shifted
      ? [{ claim: plan.claim, owner: shifted.claim, direct: false }]
      : [];
  });

  const candidateRuns = new Map(
    candidates.map(candidate => [
      candidate.claim,
      literalProbeWindows(
        replay.replacements.get(candidate.claim) ?? candidate.claim.replacement,
        PROBE_RUN_MIN_LENGTH,
        PROBE_RUN_MAX_LENGTH,
        (replay.delimiters.get(candidate.claim) ??
          candidate.claim.delimiter) === '`'
      ),
    ])
  );
  const pristinePresence = presentLiterals(
    pristine,
    [...candidateRuns.values()].flat()
  );

  if (process.env.TWEAKCC_PREFLIGHT_DUMP) {
    await fs.writeFile(
      process.env.TWEAKCC_PREFLIGHT_DUMP + '.cands',
      candidates.map(c => `${c.claim.id} <- ${c.owner.id}`).join('\n')
    );
    await fs.writeFile(
      process.env.TWEAKCC_PREFLIGHT_DUMP + '.landings',
      replayPlans
        .map(
          plan =>
            `${plan.claim.id}[${plan.claim.site}]=${replay.landed.get(plan.claim)}`
        )
        .join('\n')
    );
    await fs.writeFile(
      process.env.TWEAKCC_PREFLIGHT_DUMP + '.mutations',
      mutations
        .map(
          mutation =>
            `${mutation.source.id}[${mutation.source.site}] -> ` +
            `[${mutation.claim.start},${mutation.claim.end})`
        )
        .join('\n')
    );
    await fs.writeFile(process.env.TWEAKCC_PREFLIGHT_DUMP, replay.content);
  }

  // A warning requires a >=25-character authored literal window that is absent
  // from pristine and from this site's final apply-order projection. Every
  // window is checked, so partial delivery still warns; backtick interpolation
  // slots are excluded because their bytes are runtime-dependent. With no such
  // distinctive window the result is info, never a claim that content was lost.
  for (const { claim, owner, direct } of candidates) {
    const cause = direct
      ? `${claim.surface} "${claim.id}" [${claim.start}, ${claim.end}) ` +
        `overlaps ${owner.surface} "${owner.id}" [${owner.start}, ` +
        `${owner.end}), which the apply splices first`
      : `${owner.surface} "${owner.id}" [${owner.start}, ${owner.end}) ` +
        `rewrites an earlier site before catalogue ordinal ${claim.site} of ` +
        `${claim.surface} "${claim.id}" can be consumed`;

    const destination = replay.destinations.get(claim);
    const projected = destination ?? surfaces.mapper.spanToCurrent(claim);
    const siteContent = replay.content.slice(projected.start, projected.end);
    const replacement = replay.replacements.get(claim) ?? claim.replacement;
    if (replacement.length > 0 && siteContent.includes(replacement)) {
      continue;
    }
    const runs = (candidateRuns.get(claim) ?? []).filter(
      run => !pristinePresence.has(run)
    );
    if (runs.length === 0) {
      findings.push({
        check: 'ownership',
        severity: 'info',
        id: claim.id,
        site: claim.site,
        message:
          `${cause}. Undecidable by content probe: every literal run this ` +
          `override writes is under ${PROBE_RUN_MIN_LENGTH} characters or ` +
          'already present in the pristine binary, so there is nothing ' +
          'distinctive to search the patched result for. Verify this one by ' +
          'hand',
      });
      continue;
    }
    const delivered = presentLiterals(siteContent, runs);
    const missing = runs.filter(run => !delivered.has(run));
    if (process.env.TWEAKCC_PREFLIGHT_DUMP) {
      await fs.writeFile(
        process.env.TWEAKCC_PREFLIGHT_DUMP + '.jsonl',
        JSON.stringify({
          id: claim.id,
          landed: replay.landed.get(claim) ?? false,
          present: runs.filter(run => !missing.includes(run)),
          missing,
        }) + '\n',
        { flag: 'a' }
      );
    }
    if (missing.length === 0) continue;

    findings.push({
      check: 'ownership',
      severity: 'warning',
      id: claim.id,
      site: claim.site,
      offending: missing[0].slice(0, 80),
      message:
        `${cause}. Authored text is absent from this site after exact ` +
        'apply-order replay — that content never reaches the model. Declare ' +
        '`shadows:` on the owner, align the two, or drop the redundant override',
    });
  }

  return {
    version,
    promptsChecked: prompts.length,
    sitesChecked,
    findings: dedupe(findings),
  };
};

export const formatPreflightFinding = (f: PreflightFinding): string => {
  const where = f.line !== undefined ? `${f.id}.md:${f.line}` : f.id;
  const head = `[${f.check}] ${where} (site ${f.site}): ${f.message}`;
  return f.lineText === undefined
    ? head
    : `${head}\n    ${f.lineText.trim().slice(0, 200)}`;
};
