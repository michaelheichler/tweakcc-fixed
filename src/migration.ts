import path from 'node:path';
import fs from 'node:fs/promises';

import { TweakccConfig } from './types';
import { CONFIG_FILE, ensureConfigDir } from './config';

/**
 * In v3.2.0 we changed the user message display config.  This function migrates the old config.
 * @param readConfig The config that was read.
 */
export const migrateUserMessageDisplayToV320 = (readConfig: TweakccConfig) => {
  // Across v3.2.x, userMessageDisplay was restructured from prefix/message to a
  // single format string, then border props, paddingX/paddingY (split from a
  // single `padding`), and fitBoxToContent were added.
  const orig = readConfig?.settings?.userMessageDisplay as unknown as
    | ({
        prefix?: {
          format: string;
          styling: string[];
          foregroundColor: string;
          backgroundColor: string;
        };
        message?: {
          format: string;
          styling: string[];
          foregroundColor: string;
          backgroundColor: string;
        };
        padding?: number;
      } & Record<string, unknown>)
    | undefined;

  if (!orig) return;

  // Snapshot the ORIGINAL shape up front and key every condition below off this
  // snapshot, never the live object. When there is no `prefix`, the live
  // userMessageDisplay IS `orig`, so a block that adds e.g. `paddingX` would
  // otherwise make a later `!('paddingX' in …)` check skip and drop the user's
  // `padding`. (This is the bug fix: the border block used to set paddingX,
  // pre-empting the padding-split below.)
  const hadPrefix = !!orig.prefix;
  const hadBorderStyle = 'borderStyle' in orig;
  const hadPadding = 'padding' in orig;
  const hadPaddingX = 'paddingX' in orig;
  const hadFitBoxToContent = 'fitBoxToContent' in orig;
  const origPadding = orig.padding;

  // 1. prefix/message -> single format string.
  if (hadPrefix) {
    readConfig.settings.userMessageDisplay = {
      format: (orig.prefix?.format || '') + (orig.message?.format || '{}'),
      styling: [
        ...(orig.prefix?.styling || []),
        ...(orig.message?.styling || []),
      ],
      foregroundColor:
        orig.message?.foregroundColor === 'rgb(0,0,0)'
          ? 'default'
          : orig.message?.foregroundColor ||
            orig.prefix?.foregroundColor ||
            'default',
      backgroundColor:
        orig.message?.backgroundColor === 'rgb(0,0,0)'
          ? null
          : orig.message?.backgroundColor ||
            orig.prefix?.backgroundColor ||
            null,
      borderStyle: 'none',
      borderColor: 'rgb(255,255,255)',
      paddingX: 0,
      paddingY: 0,
      fitBoxToContent: false,
    };
  }

  const umd = readConfig.settings.userMessageDisplay;

  // 2. border properties added. (paddingX/paddingY belong to the split below,
  // so this block must NOT touch them — see the snapshot note above.)
  if (!hadBorderStyle) {
    umd.borderStyle = 'none';
    umd.borderColor = 'rgb(255,255,255)';
  }

  // 3. single `padding` split into paddingX/paddingY.
  if (hadPadding && !hadPaddingX) {
    umd.paddingX = origPadding || 0;
    umd.paddingY = 0;
    delete (umd as unknown as Record<string, unknown>).padding;
  } else if (!hadPaddingX) {
    // No legacy `padding` and no paddingX yet -> initialize the new defaults.
    umd.paddingX = 0;
    umd.paddingY = 0;
  }

  // 4. fitBoxToContent added.
  if (!hadFitBoxToContent) {
    umd.fitBoxToContent = false;
  }
};

/**
 * Migrates old hideCtrlGToEditPrompt to hideCtrlGToEdit.
 * @param readConfig The config that was read.
 */
export const migrateHideCtrlGToEditPrompt = (readConfig: TweakccConfig) => {
  const misc = readConfig?.settings?.misc as unknown as Record<string, unknown>;
  if (misc && 'hideCtrlGToEditPrompt' in misc) {
    misc.hideCtrlGToEdit = misc.hideCtrlGToEditPrompt;
    delete misc.hideCtrlGToEditPrompt;
  }
};

/**
 * Migrates old ccInstallationDir config to ccInstallationPath if needed.
 * This should be called once at startup before any readConfigFile() calls.
 * @returns true if migration occurred, false otherwise
 */
export async function migrateConfigIfNeeded(): Promise<boolean> {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf8');
    const rawConfig = JSON.parse(content) as Record<string, unknown>;

    if (!Object.hasOwn(rawConfig, 'ccInstallationDir')) {
      return false;
    }

    // Migrate ccInstallationDir to ccInstallationPath
    if (rawConfig.ccInstallationDir && !rawConfig.ccInstallationPath) {
      rawConfig.ccInstallationPath = path.join(
        rawConfig.ccInstallationDir as string,
        'cli.js'
      );
    }

    // Remove the old key
    delete rawConfig.ccInstallationDir;

    // Save the migrated config
    rawConfig.lastModified = new Date().toISOString();
    await ensureConfigDir();
    await fs.writeFile(CONFIG_FILE, JSON.stringify(rawConfig, null, 2));

    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // Config file doesn't exist, no migration needed
      return false;
    }
    if (error instanceof SyntaxError) {
      // Corrupt config.json — nothing to migrate. readConfigFile recovers it
      // (moves it aside + resets to defaults); don't crash before then (F-69).
      return false;
    }
    throw error;
  }
}
