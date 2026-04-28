import type { Result } from "@bedrock/ocale";

import type { Config, EnvironmentEntry, GamePassEntry, PlaceEntry } from "../schema.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { PlaceFoldEntry } from "./fold-places.ts";
import type { MigrateError, MigrationWarning } from "./migration-report.ts";

/**
 * Inputs for {@link factorizeEnvironments}. The fold map is keyed by
 * environment name and iterates in insertion order (the order the
 * environments appeared in the original Mantle state file).
 */
export interface FactorizeInputs {
	/** Per-environment fold results keyed by environment name. */
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
	/**
	 * Caller-supplied primary environment hint. When omitted and the input
	 * declares exactly one environment, that environment is auto-picked;
	 * any other shape returns `Err({ kind: "primaryEnvironmentRequired" })`.
	 */
	readonly primaryEnvironment: string | undefined;
}

/**
 * Successful output of {@link factorizeEnvironments}: the bedrock config
 * with primary's resolved values at the root and per-environment overlays
 * carrying the fields that diverge, plus the resolved primary name and an
 * aggregated warnings list.
 */
export interface FactorizeResult {
	/** Bedrock config carrying primary's resolved values and per-environment overlays. */
	readonly config: Config;
	/** Primary environment that seeded the root (auto-picked or echoed back). */
	readonly primaryEnvironment: string;
	/** Warnings discovered during factorization; empty in this slice. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

type PlaceOverlayEntry = NonNullable<EnvironmentEntry["places"]>[string];

/**
 * Project per-environment fold results into a single bedrock `Config` by
 * factoring the chosen primary environment's resolved values up to the root
 * and recording per-environment overlays for fields that diverge from the
 * primary. Pure: no I/O.
 *
 * Primary selection: a single-environment input auto-picks; any other shape
 * requires `inputs.primaryEnvironment` and returns
 * `Err({ kind: "primaryEnvironmentRequired" })` when omitted, or
 * `Err({ kind: "primaryEnvironmentNotFound" })` when the supplied name is
 * not in the fold map.
 *
 * @param inputs - Per-environment folds and the optional primary hint.
 * @returns `Ok` with the factorized config on success, or `Err` with a
 *   discriminated `MigrateError` on primary-selection failure.
 */
export function factorizeEnvironments(
	inputs: FactorizeInputs,
): Result<FactorizeResult, MigrateError> {
	const available = [...inputs.folds.keys()];
	const primaryResult = pickPrimary(available, inputs.primaryEnvironment);
	if (!primaryResult.success) {
		return primaryResult;
	}

	const primaryName = primaryResult.data;
	const primaryFold = inputs.folds.get(primaryName);
	const config = buildConfig(inputs.folds, primaryFold);

	return {
		data: { config, primaryEnvironment: primaryName, warnings: [] },
		success: true,
	};
}

function pickPrimary(
	available: ReadonlyArray<string>,
	requested: string | undefined,
): Result<string, MigrateError> {
	if (requested === undefined) {
		const [only, ...rest] = available;
		if (only === undefined || rest.length > 0) {
			return {
				err: { available, kind: "primaryEnvironmentRequired" },
				success: false,
			};
		}

		return { data: only, success: true };
	}

	if (!available.includes(requested)) {
		return {
			err: { available, kind: "primaryEnvironmentNotFound", requested },
			success: false,
		};
	}

	return { data: requested, success: true };
}

function buildRootPlaces(
	primaryFold: EnvironmentFoldResult | undefined,
): Record<string, PlaceEntry> | undefined {
	if (primaryFold === undefined || primaryFold.places.size === 0) {
		return undefined;
	}

	return Object.fromEntries(
		[...primaryFold.places.entries()].map(([key, fold]) => [key, { ...fold.entry }]),
	);
}

function buildRootPasses(
	primaryFold: EnvironmentFoldResult | undefined,
): Record<string, GamePassEntry> | undefined {
	const passes = primaryFold?.passes ?? [];
	if (passes.length === 0) {
		return undefined;
	}

	return Object.fromEntries(passes.map(({ key, entry }) => [key, entry]));
}

function buildPlaceOverlayEntry(
	fold: PlaceFoldEntry,
	primary: PlaceFoldEntry | undefined,
): PlaceOverlayEntry {
	if (primary === undefined || primary.entry.filePath === fold.entry.filePath) {
		return { placeId: fold.placeId };
	}

	return { filePath: fold.entry.filePath, placeId: fold.placeId };
}

function buildPlacesOverlay(
	fold: EnvironmentFoldResult,
	primary: EnvironmentFoldResult | undefined,
): Record<string, PlaceOverlayEntry> | undefined {
	if (fold.places.size === 0) {
		return undefined;
	}

	const overlay: Record<string, PlaceOverlayEntry> = {};
	for (const [key, foldEntry] of fold.places) {
		overlay[key] = buildPlaceOverlayEntry(foldEntry, primary?.places.get(key));
	}

	return overlay;
}

function buildEnvironmentEntry(
	fold: EnvironmentFoldResult,
	primary: EnvironmentFoldResult | undefined,
): EnvironmentEntry {
	const places = buildPlacesOverlay(fold, primary);
	if (places === undefined) {
		return {};
	}

	return { places };
}

function buildEnvironmentEntries(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	primaryFold: EnvironmentFoldResult | undefined,
): Record<string, EnvironmentEntry> {
	const entries: Record<string, EnvironmentEntry> = {};
	for (const [name, fold] of folds) {
		entries[name] = buildEnvironmentEntry(fold, primaryFold);
	}

	return entries;
}

function buildConfig(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	primaryFold: EnvironmentFoldResult | undefined,
): Config {
	const environments = buildEnvironmentEntries(folds, primaryFold);
	const places = buildRootPlaces(primaryFold);
	const passes = buildRootPasses(primaryFold);
	const universe = primaryFold?.universe?.entry;

	const config: Config = { environments };
	if (passes !== undefined) {
		config.passes = passes;
	}

	if (places !== undefined) {
		config.places = places;
	}

	if (universe !== undefined) {
		config.universe = universe;
	}

	return config;
}
