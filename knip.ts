// cspell:ignore pncat

import type { KnipConfig } from "knip";

const STRYKER_CONFIG = "stryker.config.ts";

const config: KnipConfig = {
	// Vendored agent skills; third-party code outside the workspace graph.
	ignore: [".agents/skills/**"],
	ignoreDependencies: [
		"@stryker-mutator/core",
		"@stryker-mutator/typescript-checker",
		"@stryker-mutator/vitest-runner",
	],
	ignoreWorkspaces: ["apps/e2e"],
	workspaces: {
		".": {
			entry: ["scripts/**/*.ts", "pncat.config.ts"],
			ignoreDependencies: [
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
		// Entry is the file the bedrock CLI spawns by path; knip follows its
		// imports from there, so a dead export in an example still reports.
		"examples/ci-codegen": {
			entry: ["bedrock.config.ts", ".bedrock/deploy.ts"],
			// roblox-ts game sources; rbxtsc compiles them on "pnpm build",
			// with its own TypeScript rather than this repo's.
			ignore: ["src/**"],
			// The Roblox packages are invisible to knip: the type packages load
			// through the roblox tsconfig's typeRoots and are never imported, and
			// @rbxts/services is imported only from the ignored src tree above.
			ignoreDependencies: ["@rbxts/compiler-types", "@rbxts/services", "@rbxts/types"],
		},
		// Pure Luau: no TypeScript to enter from, and @bedrock-rbx/core is used
		// through its `bedrock` binary rather than imported.
		"examples/minimal": {
			entry: [],
			ignoreDependencies: ["@bedrock-rbx/core"],
		},
		"packages/actions": {
			entry: [STRYKER_CONFIG],
		},
		"packages/bedrock": {
			entry: [STRYKER_CONFIG, "tests/integration/fixtures/**/*.{ts,js}"],
		},
		"packages/change-intents": {
			entry: [STRYKER_CONFIG],
		},
		"packages/open-cloud": {
			entry: [STRYKER_CONFIG, "scripts/**/*.ts", "src/**/index.ts", "tests/helpers/lite.ts"],
		},
		"packages/state-s3": {
			entry: [STRYKER_CONFIG],
		},
		"packages/testing": {
			entry: [STRYKER_CONFIG],
		},
		"packages/typescript-config": {},
		"packages/vite-config": {},
	},
};

export default config;
