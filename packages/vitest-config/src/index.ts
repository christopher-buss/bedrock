import type { ViteUserConfig } from "vitest/config";

export const sharedConfig = {
	resolve: {
		conditions: ["source", "import", "module", "default"],
	},
	test: {
		coverage: {
			exclude: [
				"src/**/*.d.ts",
				"src/**/*.test.{ts,tsx}",
				"src/**/*.spec.{ts,tsx}",
				"src/**/__tests__/**",
				"src/**/__fixtures__/**",
			],
			include: ["src/**/*.{ts,tsx}"],
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
