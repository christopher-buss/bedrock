import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

interface TypescriptCheckerPluginOptions {
	typescriptChecker: {
		prioritizePerformanceOverAccuracy: boolean;
	};
}

export const sharedStrykerConfig = {
	checkers: ["typescript"],
	coverageAnalysis: "perTest",
	ignoreStatic: true,
	incremental: true,
	incrementalFile: "reports/stryker-incremental.json",
	mutate: ["src/**/*.ts", "!src/**/*.d.ts", "!src/**/*.spec.ts", "!src/**/*.spec-d.ts"],
	plugins: ["@stryker-mutator/typescript-checker", "@stryker-mutator/vitest-runner"],
	reporters: ["html", "clear-text", "progress"],
	testRunner: "vitest",
	thresholds: {
		break: 100,
		high: 100,
		low: 100,
	},
	tsconfigFile: "tsconfig.json",
	typescriptChecker: {
		prioritizePerformanceOverAccuracy: true,
	},
} satisfies PartialStrykerOptions & TypescriptCheckerPluginOptions;
