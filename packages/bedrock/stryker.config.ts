import { sharedStrykerConfig } from "@bedrock/testing/stryker";
import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

export default {
	...sharedStrykerConfig,
	// Override perTest with "all" so module-init code (top-level arktype
	// schema constructions in core/schema.ts) gets mutation coverage. perTest
	// cannot attribute coverage to specific tests for code that runs once at
	// import time, leaving every collection-pattern mutant ungraded.
	// `ignoreStatic` only applies to perTest, so it is disabled here.
	coverageAnalysis: "all",
	ignoreStatic: false,
} satisfies PartialStrykerOptions;
