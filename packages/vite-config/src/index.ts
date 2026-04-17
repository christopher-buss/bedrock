import process from "node:process";
import type { ViteUserConfig } from "vite-plus";

export const sharedConfig = {
	pack: {
		clean: true,
		dts: true,
		entry: ["src/index.ts"],
		exports: {
			devExports: "source",
		},
		fixedExtension: true,
		format: ["esm"],
		publint: true,
		shims: true,
		sourcemap: true,
		tsconfig: "tsconfig.build.json",
		unused: { level: "error" },
	},
	resolve: {
		conditions: ["source", "module", "default"],
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
		setupFiles: ["@bedrock/testing/jest-extended"],
		typecheck: {
			enabled: process.env["VITEST_TYPECHECK"] !== "false",
		},
	},
} satisfies ViteUserConfig;
