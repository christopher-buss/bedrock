import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

export const sharedStrykerConfig = {
	coverageAnalysis: "perTest",
	incremental: true,
	incrementalFile: "reports/stryker-incremental.json",
	reporters: ["html", "clear-text", "progress"],
	testRunner: "vitest",
	thresholds: {
		break: 100,
		high: 100,
		low: 100,
	},
} satisfies PartialStrykerOptions;
