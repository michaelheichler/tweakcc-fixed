# As Is

Claude Code 2.1.217 is installed on both hosts. Tweakcc 2.7.9 supports 2.1.216 prompt data. Its rebuilt code patches match 2.1.217, but prompt extraction leaves anonymous and dropped prompt identities.

# To Be

Tweakcc carries a verified 2.1.217 prompt corpus and applies without code-patch failures. Existing override content stays intact except for version-specific inline anchors.

# Requirements

1. Restore every surviving 2.1.216 prompt identity. Classify new 2.1.217 strings by their real runtime audience.
2. Keep current code-patch behavior and validate it from a fresh build.
3. Do not overwrite or clean the dirty lobotomized override repository.
4. Verify on macOS ARM and Linux x86 without copying platform binaries.

# Acceptance Criteria

1. Corpus extraction has no anonymous prompts and no unexplained named-ID regression.
2. A rebuilt local apply has no failed code-patch anchors.
3. Existing override bodies remain unchanged. Only stale 2.1.217 inline anchors may change.
4. Both Claude installations report 2.1.217 and retain their hook fingerprints.

# Testing Plan

1. Add focused classification regression coverage for changed and new prompt identities.
2. Run extractor, version-bump report, lint, tests, and build.
3. Apply against a copied tweakcc configuration and inspect hygiene output.
4. Deploy source and architecture-local builds independently, then smoke-test both hosts.

# Implementation Plan

1. Classify new prompt strings with focused tests.
2. Regenerate the 2.1.217 corpus and drive extraction counters to zero.
3. Build and apply in staging, then publish the compatible tweakcc release.
4. Pull and build independently on Tux, apply locally, and verify hooks and runtime health.
