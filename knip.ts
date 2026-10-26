// cspell:ignore pncat

import type { KnipConfig } from "knip";

const STRYKER_CONFIG = "stryker.config.ts";

const config: KnipConfig = {
	// Vendored agent skills; third-party code outside the workspace graph.
	ignore: [".agents/skills/**", ".claude/skills/**"],
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
			// root. knip cannot trace that across workspaces, so list it as a
			// runtime binary.
			ignoreBinaries: ["stryker"],
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
