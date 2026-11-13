import {
  ReminderInjection,
  findCaseBody,
  isSuppressedCase,
  slotExpr,
} from './reminderShared';
import {
  applyBuilderCase,
  localFor,
  segmentFor,
  guardedValue,
  guardedData,
} from './reminderBuilder';
import { escapeRe, interpolations } from './reminderSyntax';

export const MEMORY_UPDATE_INJECTION: ReminderInjection = {
  id: 'memory-update',
  previousDefaultBodies: [
    '{{source}} updated your memory directory: {{summary}}\nFiles changed: {{paths}}\nYour loaded copy of {{in_context_paths}} is now stale relative to disk \u2014 Read it again if you need current contents.\nThis is ambient context \u2014 do not narrate it to the user unless they ask or it is directly relevant to their request.',
  ],
  name: 'Memory-update reminder',
  description:
    'Fires after dream / consolidation writes new memory files. Conditional. Empty .md body = silent updates. ' +
    '{{source}} names the process that wrote; {{summary}} is its summary. ' +
    '{{files_changed}} is the "Files changed: …" line and {{stale_copy}} the "Your loaded copy of … is now stale" line, each empty when it does not apply; ' +
    '{{paths}} / {{in_context_paths}} are the bare escaped path lists for your own wording. ' +
    'A line holding only such optional placeholders (plus your own text) disappears when they are all empty. ' +
    '{{ambient_note}} is the "This is ambient context" suffix. The sync_unsaved summary-only branch always stays pristine.',
  shadows: ['system-reminder-memory-update-loaded-copy-stale'],
  placeholders: {
    source: '${H.sourceLabel}',
    summary: '${H.summary}',
    files_changed: '${H.filesChangedLine}',
    stale_copy: '${H.staleCopyLine}',
    paths: '${H.paths.join(", ")}',
    in_context_paths: '${H.inContextPaths.join(", ")}',
    ambient_note: '${H.ambientNote}',
  },
  defaultBody:
    '{{source}} updated your memory directory: {{summary}}\n{{files_changed}}\n{{stale_copy}}\n{{ambient_note}}',
  apply(content, body, isSuppressed) {
    const found = findCaseBody(
      content,
      'memory_update',
      'updated your memory directory'
    );
    if (!found) {
      if (isSuppressed && isSuppressedCase(content, 'memory_update'))
        return content;
      console.error('patch: reminder memory-update: failed to find case body');
      return null;
    }
    return applyBuilderCase(
      content,
      'memory-update',
      found,
      body,
      isSuppressed,
      'summary',
      (b, p, caseBody) => {
        const sourceRe = new RegExp(
          `^(?:(?:[$\\w]+\\()+${escapeRe(p)}\\.source\\)+|[$\\w]+\\[${escapeRe(p)}\\.source\\])$`
        );
        const source =
          interpolations(caseBody).find(x => sourceRe.test(x)) ?? null;
        const pathsLocal = localFor(b, p, 'paths');
        const staleLocal = localFor(b, p, 'inContextPaths');
        const files = segmentFor(b, pathsLocal);
        const stale = segmentFor(b, staleLocal);
        return [
          { token: '${H.sourceLabel}', expr: source },
          { token: '${YT3[H.source]}', expr: source },
          { token: '${H.summary}', expr: slotExpr(caseBody, p, 'summary') },
          {
            token: '${H.filesChangedLine}',
            expr: files && guardedValue(files, 0),
            optional: true,
          },
          {
            token: '${H.staleCopyLine}',
            expr: stale && guardedValue(stale, 0),
            optional: true,
          },
          {
            token: '${H.paths.join(", ")}',
            expr: guardedData(files, pathsLocal),
            optional: true,
          },
          {
            token: '${H.inContextPaths.join(", ")}',
            expr: guardedData(stale, staleLocal),
            optional: true,
          },
          { token: '${H.ambientNote}', expr: b.tail[0] ?? null },
        ];
      }
    );
  },
};
