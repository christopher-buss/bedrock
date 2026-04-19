// cspell:ignore pncat

import type { KnipConfig } from "knip";

const STRYKER_DEPS = [
	"@stryker-mutator/core",
	"@stryker-mutator/typescript-checker",
	"@stryker-mutator/vitest-runner",
] as const;

const OXC_MINIFY = "oxc-minify";

const config: KnipConfig = {
	stryker: true,
	vitepress: true,
	vitest: true,
	workspaces: {
		".": {
			entry: ["scripts/**/*.ts", ".claude/hooks/**/*.ts", "pncat.config.ts"],
			ignoreDependencies: [
				"@eslint/config-inspector",
				"@isentinel/hooks",
				"better-typescript-lib",
				"eslint-plugin-erasable-syntax-only",
				"eslint-plugin-pnpm",
				"eslint_d",
				"file-entry-cache",
				"get-tsconfig",
				"madge",
				OXC_MINIFY,
				"publint",
				"unplugin-unused",
			],
		},
		"apps/e2e": {
			ignoreBinaries: ["vitest"],
			ignoreDependencies: ["@bedrock/ocale", "@bedrock/vite-config", "bedrock", "vitest"],
		},
		"apps/website": {},
		"packages/cli": {
			entry: ["stryker.config.ts", "src/**/index.ts"],
			ignoreDependencies: ["@bedrock/ocale", ...STRYKER_DEPS, OXC_MINIFY],
		},
		"packages/open-cloud": {
			entry: [
				"stryker.config.ts",
				"scripts/**/*.ts",
				"src/**/index.ts",
				"tests/helpers/index.ts",
			],
			ignoreDependencies: [...STRYKER_DEPS, OXC_MINIFY],
		},
		"packages/testing": {
			ignoreDependencies: [...STRYKER_DEPS],
		},
		"packages/typescript-config": {},
		"packages/vite-config": {},
	},
};

export default config;
