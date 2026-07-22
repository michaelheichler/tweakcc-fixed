# As Is

An untouched generated prompt file can be reused for multiple prompt sites with the same ID. When sibling sites have different pristine text, tweakcc injects the first site's content into later sites and can consume anchors needed by later prompts.

# To Be

Tweakcc does not apply an override when the shared Markdown content still equals the current version's first pristine prompt for that ID. Customized prompts keep the existing apply and drift reporting behavior.

# Requirements

1. Detect pristine prompt content once per prompt ID from the loaded current-version corpus.
2. Skip every site for that ID when its Markdown content is pristine.
3. Preserve current behavior for customized prompts.
4. Add no dependency or new abstraction.

# Acceptance Criteria

1. A pristine shared prompt does not alter a sibling site with different text.
2. A customized prompt whose anchor is absent still reports genuine drift.
3. The focused test, full test suite, build, and Linux pristine apply pass.

# Testing Plan

1. Add a regression with two differently shaped sites that share one pristine Markdown file.
2. Run the focused test before implementation and confirm it fails.
3. Add the smallest shared guard and rerun the focused test.
4. Run the complete test and build checks, then validate against Claude Code 2.1.217 on both hosts.

# Implementation Plan

1. Build a first-pristine-content map from the already loaded prompt entries.
2. Skip entries whose Markdown content equals that ID's first pristine content.
3. Preserve existing hash behavior for customized prompts.
