// cspell:ignore pncat

import type { KnipConfig } from "knip";

const STRYKER_CONFIG = "stryker.config.ts";

const config: KnipConfig = {
	ignore: [".sandcastle/worktrees/**"],
	ignoreDependencies: [
		"@stryker-mutator/core",
		"@stryker-mutator/typescript-checker",
		"@stryker-mutator/vitest-runner",
	],
	ignoreWorkspaces: ["apps/e2e"],
	workspaces: {
		".": {
			entry: ["scripts/**/*.ts", "pncat.config.ts"],
			// `stryker` is run via `pnpm exec` from each package directory, so it
			// resolves from that package's node_modules/.bin rather than the
			// root; the mutate-* scripts spawn each other via `bun <path>`. knip
			// cannot trace either across workspaces, so list them as runtime
			// binaries.
			ignoreBinaries: ["stryker", "scripts/mutate-changed.ts", "scripts/mutate-remote.ts"],
			ignoreDependencies: [
				"@bedrock-rbx/core",
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
		"apps/website": {
			entry: ["landing/examples/**/*.ts"],
		},
		"packages/actions": {
			entry: [STRYKER_CONFIG],
		},
		"packages/bedrock": {
			entry: [STRYKER_CONFIG, "tests/integration/fixtures/**/*.{ts,js}"],
		},
		"packages/open-cloud": {
			entry: [STRYKER_CONFIG, "scripts/**/*.ts", "src/**/index.ts", "tests/helpers/lite.ts"],
		},
		"packages/testing": {},
		"packages/typescript-config": {},
		"packages/vite-config": {},
	},
};

export default config;
