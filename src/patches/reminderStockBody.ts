import {
  normalizeLineEndings,
  substitutePlaceholders,
} from '../systemReminderSync';
import { ReminderInjection } from './reminderShared';

export const normalizeBody = (body: string): string =>
  normalizeLineEndings(body).replace(/\n$/, '');

export const withStockBodyNoop = (
  injection: ReminderInjection
): ReminderInjection => {
  if (injection.bodyIsMarker) return injection;
  let stock: Set<string> | null = null;
  return {
    ...injection,
    apply(content, body, isSuppressed) {
      stock ??= new Set(
        [injection.defaultBody, ...(injection.previousDefaultBodies ?? [])]
          .map(b => substitutePlaceholders(b, injection.placeholders))
          .filter(r => r.errors.length === 0)
          .map(r => normalizeBody(r.result))
      );
      if (!isSuppressed && stock.has(normalizeBody(body))) return content;
      return injection.apply(content, body, isSuppressed);
    },
  };
};
