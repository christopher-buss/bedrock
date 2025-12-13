import type { ViteUserConfig } from "vitest/config";

export const sharedConfig = {
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			thresholds: {
				branches: 100,
				functions: 100,
				lines: 100,
				statements: 100,
			},
		},
		globals: false,
		passWithNoTests: true,
		reporters: "dot",
		typecheck: {
			enabled: true,
		},
	},
} satisfies ViteUserConfig;
