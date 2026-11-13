import chalk from 'chalk';
import { SYSTEM_PROMPTS_DIR } from './config';
import { SyncResult, SyncSummary } from './systemPromptMarkdown';

const displayCreatedPrompts = (created: SyncResult[]): void => {
  if (created.length > 0) {
    console.log(
      chalk.bold.green(`Created ${created.length} new prompt file(s):`)
    );
    for (const result of created) {
      console.log(chalk.green(`  ${SYSTEM_PROMPTS_DIR}/${result.id}.md`));
      console.log(chalk.green.dim(`    ${result.description}`));
    }
    console.log();
  }
};

const displayUpdatedPrompts = (updated: SyncResult[]): void => {
  if (updated.length > 0) {
    console.log(
      chalk.bold.blue(`Updated ${updated.length} system prompt file(s):`)
    );
    for (const result of updated) {
      if (result.oldVersion) {
        console.log(
          chalk.blue(
            `  ${result.id}.md  (${result.oldVersion} → ${result.newVersion})`
          )
        );
      } else {
        console.log(chalk.blue(`  ${result.id}.md  (→ ${result.newVersion})`));
      }
    }
    console.log();
  }
};

const displayPromptConflicts = (conflicts: SyncResult[]): void => {
  if (conflicts.length > 0) {
    console.log(
      chalk.bold.yellow(
        `WARNING: Conflicts detected for ${conflicts.length} system prompt file(s)`
      )
    );
    for (const result of conflicts) {
      console.log(
        chalk.yellow(
          ` ${result.id}.md (${result.oldVersion} → ${result.newVersion})`
        )
      );
      console.log(
        chalk.yellow(`   Open the diff in your browser: ${result.diffHtmlPath}`)
      );
    }
    console.log();
  }
};

const displayCreationInstructions = (created: SyncResult[]): void => {
  if (created.length > 0) {
    console.log(
      chalk.green.bold(
        `New prompt files have been created; either more are now supported by tweakcc or Anthropic has added new ones.`
      )
    );
    console.log(
      chalk.green(
        `You can now customize the markdown files at ${SYSTEM_PROMPTS_DIR} in a text editor.`
      )
    );
    console.log(
      chalk.green(
        `Then run tweakcc and select "apply" or use tweakcc --apply to update your system prompts`
      )
    );
    console.log();
  }
};

const displayConflictInstructions = (conflicts: SyncResult[]): void => {
  if (conflicts.length > 0) {
    console.log();
    console.log(`Review conflicts:`);
    console.log(`  1. Open the diff HTML files in your browser`);
    console.log(`  2. Verify your customizations are still appropriate`);
    console.log(`  3. Update your markdown files if needed`);
    console.log(
      chalk.bold.cyan(
        `  4. Important: Update the ccVersion in your markdown files to the latest version of each prompt:`
      )
    );
    for (const result of conflicts) {
      console.log(
        chalk.yellow(`      ${result.id}.md → `) +
          chalk.bold.magenta(result.newVersion)
      );
    }
    console.log(`  5. Delete the diff HTML files`);
    console.log();
  }
};

export const displaySyncResults = (summary: SyncSummary): void => {
  const created = summary.results.filter(r => r.action === 'created');
  const updated = summary.results.filter(r => r.action === 'updated');
  const conflicts = summary.results.filter(r => r.action === 'conflict');
  const skipped = summary.results.filter(r => r.action === 'skipped');
  if (
    (created.length > 0 || updated.length > 0 || conflicts.length > 0) &&
    skipped.length > 0
  ) {
    console.log(chalk.dim(`Skipped ${skipped.length} up-to-date file(s)`));
    console.log();
  }
  displayCreatedPrompts(created);
  displayUpdatedPrompts(updated);
  displayPromptConflicts(conflicts);
  displayCreationInstructions(created);
  displayConflictInstructions(conflicts);
};
