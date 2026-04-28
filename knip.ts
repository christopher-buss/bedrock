// cspell:ignore pncat

import type { KnipConfig } from "knip";

const config: KnipConfig = {
	ignoreDependencies: [
		"@stryker-mutator/core",
		"@stryker-mutator/typescript-checker",
		"@stryker-mutator/vitest-runner",
	],
	ignoreWorkspaces: ["apps/e2e"],
	workspaces: {
		".": {
			entry: ["scripts/**/*.ts", ".claude/hooks/**/*.ts", "pncat.config.ts"],
			ignoreDependencies: [
				"@bedrock/core",
				"@eslint/config-inspector",
				"@isentinel/hooks",
				"better-typescript-lib",
				"eslint-plugin-erasable-syntax-only",
				"eslint-plugin-pnpm",
				"eslint_d",
				"file-entry-cache",
				"get-tsconfig",
				"madge",
				"oxc-minify",
				"publint",
				"unplugin-unused",
			],
		},
		"apps/website": {},
		"packages/bedrock": {
			entry: [
				"stryker.config.ts",
				"src/cli/run.ts",
				"src/index.ts",
				"tests/integration/fixtures/**/*.{ts,js}",
			],
		},
		"packages/open-cloud": {
			entry: [
				"stryker.config.ts",
				"scripts/**/*.ts",
				"src/**/index.ts",
				"tests/helpers/index.ts",
			],
		},
		"packages/testing": {},
		"packages/typescript-config": {},
		"packages/vite-config": {},
	},
};

export default config;
