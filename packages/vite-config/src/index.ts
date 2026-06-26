import process from "node:process";
import type { UserConfig } from "vite-plus";
import type { ExportsOptions } from "vite-plus/pack";

type ExportsMap = Parameters<
	Extract<NonNullable<ExportsOptions["customExports"]>, (...args: never) => unknown>
>[0];

/**
 * Tsdown appends `./package.json` after its alphabetical sort, so packages
 * whose subpath entries sort after `package.json` (e.g. `./places`) end up
 * with an order that diverges from `eslint-plugin-perfectionist`'s expected
 * alphabetical layout. Re-sort in `customExports` (which runs last in
 * tsdown's pipeline) so the emitted package.json is stable across builds.
 * @param exportsMap - Map of subpath keys to export definitions that tsdown
 * has already populated (sorted subpaths, `./package.json` appended last).
 * @returns A new map with `.` first and remaining keys in locale order.
 */
export function sortExports(exportsMap: ExportsMap): ExportsMap {
	const sorted = Object.entries(exportsMap).toSorted(([a], [b]) => {
		if (a === ".") {
			return -1;
		}

		if (b === ".") {
			return 1;
		}

		return a.localeCompare(b);
	});
	return Object.fromEntries(sorted);
}

export const sharedConfig = {
	pack: {
		clean: true,
		dts: true,
		entry: ["src/index.ts"],
		exports: {
			customExports: sortExports,
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
	ssr: {
		resolve: {
			conditions: ["source", "module", "default"],
			externalConditions: ["source", "module", "default"],
		},
	},
	test: {
		coverage: {
			exclude: [
				"src/**/*.d.ts",
				"src/**/*.test.{ts,tsx}",
				"src/**/*.spec.{ts,tsx}",
				"src/**/*.spec-d.ts",
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
		setupFiles: ["@bedrock-rbx/testing/jest-extended"],
		typecheck: {
			checker: "tsgo",
			enabled: process.env["VITEST_TYPECHECK"] !== "false",
		},
	},
} satisfies UserConfig;
