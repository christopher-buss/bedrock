import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

export const sharedStrykerConfig = {
	coverageAnalysis: "perTest",
	incremental: true,
	incrementalFile: "reports/stryker-incremental.json",
	mutate: ["src/**/*.ts", "!src/**/*.d.ts", "!src/**/*.spec.ts", "!src/**/*.spec-d.ts"],
	plugins: ["@stryker-mutator/vitest-runner"],
	reporters: ["html", "clear-text", "progress"],
	testRunner: "vitest",
	thresholds: {
		break: 100,
		high: 100,
		low: 100,
	},
} satisfies PartialStrykerOptions;
