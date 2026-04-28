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

type PassOverlayEntry = NonNullable<EnvironmentEntry["passes"]>[string];
type PlaceOverlayEntry = NonNullable<EnvironmentEntry["places"]>[string];
type UniverseOverlay = NonNullable<EnvironmentEntry["universe"]>;

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
	const warnings = collectMissingResourceWarnings(inputs.folds, primaryName);

	return {
		data: { config, primaryEnvironment: primaryName, warnings },
		success: true,
	};
}

function pickPrimary(
	available: ReadonlyArray<string>,
	primary: string | undefined,
): Result<string, MigrateError> {
	if (primary === undefined) {
		const [only, ...rest] = available;
		if (only === undefined || rest.length > 0) {
			return {
				err: { available, kind: "primaryEnvironmentRequired" },
				success: false,
			};
		}

		return { data: only, success: true };
	}

	if (!available.includes(primary)) {
		return {
			err: { available, kind: "primaryEnvironmentNotFound", primary },
			success: false,
		};
	}

	return { data: primary, success: true };
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

function buildUniverseOverlay(
	fold: EnvironmentFoldResult,
	primary: EnvironmentFoldResult | undefined,
): undefined | UniverseOverlay {
	const foldUniverse = fold.universe;
	if (foldUniverse === undefined) {
		return undefined;
	}

	const primaryUniverseId = primary?.universe?.entry.universeId;
	if (primaryUniverseId === foldUniverse.entry.universeId) {
		return undefined;
	}

	return { universeId: foldUniverse.entry.universeId };
}

function buildPassOverlayEntry(
	entry: GamePassEntry,
	primary: GamePassEntry,
): PassOverlayEntry | undefined {
	const overlay: PassOverlayEntry = {};
	if (!Object.is(primary.name, entry.name)) {
		overlay.name = entry.name;
	}

	if (!Object.is(primary.description, entry.description)) {
		overlay.description = entry.description;
	}

	if (!Object.is(primary.iconFilePath, entry.iconFilePath)) {
		overlay.iconFilePath = entry.iconFilePath;
	}

	if (!Object.is(primary.price, entry.price)) {
		overlay.price = entry.price;
	}

	return Object.keys(overlay).length === 0 ? undefined : overlay;
}

function buildPassesOverlay(
	fold: EnvironmentFoldResult,
	primary: EnvironmentFoldResult | undefined,
): Record<string, PassOverlayEntry> | undefined {
	const primaryByKey = new Map<string, GamePassEntry>(
		primary?.passes.map(({ key, entry }) => [key, entry]),
	);
	const overlay: Record<string, PassOverlayEntry> = {};
	for (const { key, entry } of fold.passes) {
		const primaryEntry = primaryByKey.get(key);
		const passOverlay =
			primaryEntry === undefined ? { ...entry } : buildPassOverlayEntry(entry, primaryEntry);
		if (passOverlay !== undefined) {
			overlay[key] = passOverlay;
		}
	}

	return Object.keys(overlay).length === 0 ? undefined : overlay;
}

function buildEnvironmentEntry(
	fold: EnvironmentFoldResult,
	primary: EnvironmentFoldResult | undefined,
): EnvironmentEntry {
	const passes = buildPassesOverlay(fold, primary);
	const places = buildPlacesOverlay(fold, primary);
	const universe = buildUniverseOverlay(fold, primary);

	const entry: EnvironmentEntry = {};
	if (passes !== undefined) {
		entry.passes = passes;
	}

	if (places !== undefined) {
		entry.places = places;
	}

	if (universe !== undefined) {
		entry.universe = universe;
	}

	return entry;
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

const RESOURCE_MISSING_RULE = "factorize-environments/resource-missing-from-env";

interface AsymmetryContext {
	readonly environmentName: string;
	readonly fold: EnvironmentFoldResult;
	readonly primary: EnvironmentFoldResult;
}

interface MissingResourcePaths {
	readonly bedrockSegment: string;
	readonly environmentName: string;
	readonly mantleSegment: string;
}

function missingResourceWarning(paths: MissingResourcePaths): MigrationWarning {
	return {
		bedrockPath: `environments.${paths.environmentName}.${paths.bedrockSegment}`,
		kind: "interpretive",
		mantlePath: `${paths.environmentName}.${paths.mantleSegment}`,
		rule: RESOURCE_MISSING_RULE,
	};
}

function universeAsymmetryWarnings(context: AsymmetryContext): ReadonlyArray<MigrationWarning> {
	const hasEnvironmentUniverse = context.fold.universe !== undefined;
	const hasPrimaryUniverse = context.primary.universe !== undefined;
	if (hasEnvironmentUniverse === hasPrimaryUniverse) {
		return [];
	}

	return [
		missingResourceWarning({
			bedrockSegment: "universe",
			environmentName: context.environmentName,
			mantleSegment: "experience_singleton",
		}),
	];
}

function asymmetricKeys(
	environmentKeys: ReadonlyArray<string>,
	primaryKeys: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const environmentSet = new Set(environmentKeys);
	const primarySet = new Set(primaryKeys);
	const onlyInEnvironment = environmentKeys.filter((key) => !primarySet.has(key));
	const onlyInPrimary = primaryKeys.filter((key) => !environmentSet.has(key));
	return [...onlyInEnvironment, ...onlyInPrimary];
}

function placeAsymmetryWarnings(context: AsymmetryContext): ReadonlyArray<MigrationWarning> {
	return asymmetricKeys([...context.fold.places.keys()], [...context.primary.places.keys()]).map(
		(key) => {
			return missingResourceWarning({
				bedrockSegment: `places.${key}`,
				environmentName: context.environmentName,
				mantleSegment: `place_${key}`,
			});
		},
	);
}

function passAsymmetryWarnings(context: AsymmetryContext): ReadonlyArray<MigrationWarning> {
	return asymmetricKeys(
		context.fold.passes.map(({ key }) => key),
		context.primary.passes.map(({ key }) => key),
	).map((key) => {
		return missingResourceWarning({
			bedrockSegment: `passes.${key}`,
			environmentName: context.environmentName,
			mantleSegment: `pass_${key}`,
		});
	});
}

function collectMissingResourceWarnings(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	primaryName: string,
): ReadonlyArray<MigrationWarning> {
	const primary = folds.get(primaryName);
	if (primary === undefined) {
		return [];
	}

	return [...folds.entries()].flatMap(([name, fold]): ReadonlyArray<MigrationWarning> => {
		const context: AsymmetryContext = { environmentName: name, fold, primary };
		return [
			...universeAsymmetryWarnings(context),
			...placeAsymmetryWarnings(context),
			...passAsymmetryWarnings(context),
		];
	});
}
