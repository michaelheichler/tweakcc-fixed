import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { ReminderInjection, ReminderApplyResult } from './reminderShared';
import {
  CLAUDEMD_INJECTION,
  MCP_INSTRUCTIONS_INJECTION,
  AGENT_LISTING_INJECTION,
  OUTPUT_STYLE_INJECTION,
} from './reminderInjectionsContext';
import { SKILLS_INJECTION } from './reminderInjectionsSkills';
import {
  THINKING_REMINDER_INJECTION,
  ULTRATHINK_INJECTION,
  DATE_CHANGE_INJECTION,
  HOOK_ADDITIONAL_CONTEXT_INJECTION,
  HOOK_BLOCKING_ERROR_INJECTION,
  HOOK_STOPPED_INJECTION,
} from './reminderInjectionsHooks';
import {
  TOOL_CALLED_INJECTION,
  TOOL_RESULT_INJECTION,
  TOOL_ERROR_INJECTION,
  LOCAL_CMD_CAVEAT_INJECTION,
  COMPACT_FILE_REF_INJECTION,
  PDF_REF_INJECTION,
} from './reminderInjectionsTools';
import { EDITED_TEXT_FILE_INJECTION } from './reminderInjectionsEditedText';
import {
  SELECTED_LINES_INJECTION,
  OPENED_FILE_INJECTION,
  PLAN_FILE_REF_INJECTION,
  PLAN_MODE_EXIT_INJECTION,
  AUTO_MODE_EXIT_INJECTION,
  NESTED_MEMORY_INJECTION,
  AGENT_MENTION_INJECTION,
  VERIFY_PLAN_INJECTION,
} from './reminderInjectionsFiles';
import { MEMORY_UPDATE_INJECTION } from './reminderInjectionsMemory';
import {
  TOKEN_USAGE_INJECTION,
  BUDGET_USD_INJECTION,
  OUTPUT_TOKEN_USAGE_INJECTION,
  TASK_LIST_REMINDER_INJECTION,
  TASK_NOTIFICATION_FRAMING_INJECTION,
  STOP_HOOK_GOAL_INJECTION,
} from './reminderInjectionsSession';
import { USER_NEW_MSG_INJECTION } from './reminderInjectionsMessages';
import { MCP_PER_SERVER_ROUTER_INJECTION } from './reminderInjectionsMcpRouter';
import { withStockBodyNoop, normalizeBody } from './reminderStockBody';
import {
  ensureReminderOverrideFile,
  loadReminderOverride,
  substitutePlaceholders,
} from '../systemReminderSync';

export const REMINDER_REGISTRY: ReminderInjection[] = [
  CLAUDEMD_INJECTION,
  SKILLS_INJECTION,
  MCP_INSTRUCTIONS_INJECTION,
  AGENT_LISTING_INJECTION,
  OUTPUT_STYLE_INJECTION,
  THINKING_REMINDER_INJECTION,
  ULTRATHINK_INJECTION,
  DATE_CHANGE_INJECTION,
  HOOK_ADDITIONAL_CONTEXT_INJECTION,
  HOOK_BLOCKING_ERROR_INJECTION,
  HOOK_STOPPED_INJECTION,
  TOOL_CALLED_INJECTION,
  TOOL_RESULT_INJECTION,
  TOOL_ERROR_INJECTION,
  LOCAL_CMD_CAVEAT_INJECTION,
  COMPACT_FILE_REF_INJECTION,
  PDF_REF_INJECTION,
  EDITED_TEXT_FILE_INJECTION,
  SELECTED_LINES_INJECTION,
  OPENED_FILE_INJECTION,
  PLAN_FILE_REF_INJECTION,
  PLAN_MODE_EXIT_INJECTION,
  AUTO_MODE_EXIT_INJECTION,
  NESTED_MEMORY_INJECTION,
  AGENT_MENTION_INJECTION,
  MEMORY_UPDATE_INJECTION,
  VERIFY_PLAN_INJECTION,
  TOKEN_USAGE_INJECTION,
  BUDGET_USD_INJECTION,
  OUTPUT_TOKEN_USAGE_INJECTION,
  TASK_LIST_REMINDER_INJECTION,
  TASK_NOTIFICATION_FRAMING_INJECTION,
  USER_NEW_MSG_INJECTION,
  STOP_HOOK_GOAL_INJECTION,
  MCP_PER_SERVER_ROUTER_INJECTION,
].map(withStockBodyNoop);

const discoverMcpServerNames = async (): Promise<string[]> => {
  const candidates = [
    path.join(os.homedir(), '.claude.json'),
    path.join(os.homedir(), '.claude', 'mcp.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf8');
      const parsed = JSON.parse(raw) as {
        mcpServers?: Record<string, unknown>;
      };
      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        return Object.keys(parsed.mcpServers);
      }
    } catch {
      continue;
    }
  }
  return [];
};

const applyReminderOverride = async (
  content: string,
  injection: ReminderInjection,
  ccVersion: string
): Promise<{ content: string; result: ReminderApplyResult }> => {
  const created = await ensureReminderOverrideFile(
    injection.id,
    injection.name,
    injection.description,
    ccVersion,
    Object.keys(injection.placeholders),
    injection.defaultBody
  );
  const base = {
    id: injection.id,
    name: injection.name,
    description: injection.description,
    applied: false,
    failed: false,
    skipped: false,
  };
  const override = await loadReminderOverride(injection.id);
  if (!override) {
    return {
      content,
      result: {
        ...base,
        state: 'default',
        skipped: true,
        details: 'override file missing after ensure (unexpected)',
      },
    };
  }
  const { result: substituted, errors } = substitutePlaceholders(
    override.body,
    injection.placeholders
  );
  if (errors.length > 0) {
    return {
      content,
      result: {
        ...base,
        state: 'override',
        failed: true,
        details: errors.join('; '),
      },
    };
  }
  const next = injection.apply(content, substituted, override.isSuppressed);
  if (next === null) {
    return {
      content,
      result: {
        ...base,
        state: override.isSuppressed ? 'suppressed' : 'override',
        failed: true,
        details: 'patch function returned null',
      },
    };
  }
  const isStock = [
    injection.defaultBody,
    ...(injection.previousDefaultBodies ?? []),
  ].some(body => normalizeBody(body) === normalizeBody(override.body));
  const state = override.isSuppressed
    ? 'suppressed'
    : isStock
      ? 'default'
      : 'override';
  return {
    content: next,
    result: {
      ...base,
      state,
      applied: next !== content,
      details: created ? 'seeded default file' : undefined,
    },
  };
};

export const applySystemReminderOverrides = async (
  content: string,
  ccVersion: string
): Promise<{ content: string; results: ReminderApplyResult[] }> => {
  const results: ReminderApplyResult[] = [];
  let working = content;
  for (const name of await discoverMcpServerNames()) {
    await ensureReminderOverrideFile(
      `mcp-${name}`,
      `MCP server: ${name}`,
      `Instructions block content for MCP server "${name}". {{server_instructions}} expands at runtime to the server's pristine instructions. Empty body drops the server's block from the model's context. Custom body replaces it.`,
      ccVersion,
      ['server_instructions'],
      '{{server_instructions}}'
    );
  }
  for (const injection of REMINDER_REGISTRY) {
    const applied = await applyReminderOverride(working, injection, ccVersion);
    working = applied.content;
    results.push(applied.result);
  }
  return { content: working, results };
};

export type { ReminderApplyResult, ReminderInjection } from './reminderShared';
