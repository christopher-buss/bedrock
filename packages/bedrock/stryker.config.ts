import { sharedStrykerConfig } from "@bedrock/testing/stryker";
import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

export default {
	...sharedStrykerConfig,
	// Override `coverageAnalysis: "perTest"` (and the coupled
	// `ignoreStatic: true`) for this package only. The shared defaults
	// rely on PR #199's vitest-runner patch to classify top-level
	// arktype `type({...})` constructions in core/schema.ts as static
	// and mark them Ignored. The patch works locally (macOS, fresh
	// cache: 14 schema mutants Ignored, mutation score 100%), but on
	// the Ubuntu CI runner the same mutants come back Survived with
	// non-empty `coveredBy` lists, dropping the bedrock score to 80%.
	// We have not reproduced the divergence locally despite matching
	// `MUTATE_BASE_REF`, deleting all caches, and matching
	// `VITEST_TYPECHECK=false`.
	//
	// `coverageAnalysis: "all"` runs the full test suite against every
	// mutant rather than relying on per-test attribution, so the
	// classification trap doesn't apply. `ignoreStatic` is coupled and
	// must be disabled for "all" mode.
	coverageAnalysis: "all",
	ignoreStatic: false,
} satisfies PartialStrykerOptions;
