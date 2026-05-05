import type { Result } from "@bedrock/ocale";

import type {
	Config,
	DeveloperProductEntry,
	EnvironmentEntry,
	GamePassEntry,
	PlaceEntry,
} from "../schema.ts";
import { buildPlacesOverlay, buildRootPlaces } from "./factorize-places.ts";
import { buildProductsOverlay, buildRootProducts } from "./factorize-products.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { MigrateError, MigrationWarning } from "./migration-report.ts";

interface FactorizeInputs {
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
	readonly primaryEnvironment: string | undefined;
}

interface FactorizeResult {
	readonly config: Config;
	readonly primaryEnvironment: string;
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

type PassOverlayEntry = NonNullable<EnvironmentEntry["passes"]>[string];
type UniverseOverlay = NonNullable<EnvironmentEntry["universe"]>;

interface ResolvedPrimary {
	readonly name: string;
	readonly fold: EnvironmentFoldResult;
}

interface OverlayContext {
	readonly primary: EnvironmentFoldResult | undefined;
	readonly rootPlaces: Record<string, PlaceEntry> | undefined;
	readonly rootProducts: Record<string, DeveloperProductEntry> | undefined;
}

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
	const primaryResult = pickPrimary(inputs.folds, inputs.primaryEnvironment);
	if (!primaryResult.success) {
		return primaryResult;
	}

	const primary = primaryResult.data;
	return {
		data: {
			config: buildConfig(inputs.folds, primary.fold),
			primaryEnvironment: primary.name,
			warnings: collectMissingResourceWarnings({ folds: inputs.folds, primary }),
		},
		success: true,
	};
}

function pickPrimary(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	primary: string | undefined,
): Result<ResolvedPrimary, MigrateError> {
	const available = [...folds.keys()];
	const requested = primary ?? (available.length === 1 ? available[0] : undefined);
	if (requested === undefined) {
		return { err: { available, kind: "primaryEnvironmentRequired" }, success: false };
	}

	const fold = folds.get(requested);
	if (fold === undefined) {
		return {
			err: { available, kind: "primaryEnvironmentNotFound", primary: requested },
			success: false,
		};
	}

	return { data: { name: requested, fold }, success: true };
}

function buildRootPasses(
	primaryFold: EnvironmentFoldResult,
): Record<string, GamePassEntry> | undefined {
	if (primaryFold.passes.length === 0) {
		return undefined;
	}

	return Object.fromEntries(primaryFold.passes.map(({ key, entry }) => [key, entry]));
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

	if (!Object.is(primary.icon["en-us"], entry.icon["en-us"])) {
		overlay.icon = entry.icon;
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
	context: OverlayContext,
): EnvironmentEntry {
	const passes = buildPassesOverlay(fold, context.primary);
	const places = buildPlacesOverlay(fold, context.rootPlaces);
	const products = buildProductsOverlay(fold, context.rootProducts);
	const universe = buildUniverseOverlay(fold, context.primary);

	const entry: EnvironmentEntry = {};
	if (passes !== undefined) {
		entry.passes = passes;
	}

	if (places !== undefined) {
		entry.places = places;
	}

	if (products !== undefined) {
		entry.products = products;
	}

	if (universe !== undefined) {
		entry.universe = universe;
	}

	return entry;
}

function buildEnvironmentEntries(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	context: OverlayContext,
): Record<string, EnvironmentEntry> {
	const entries: Record<string, EnvironmentEntry> = {};
	for (const [name, fold] of folds) {
		entries[name] = buildEnvironmentEntry(fold, context);
	}

	return entries;
}

function buildConfig(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	primaryFold: EnvironmentFoldResult,
): Config {
	const places = buildRootPlaces(folds, primaryFold);
	const products = buildRootProducts(folds, primaryFold);
	const environments = buildEnvironmentEntries(folds, {
		primary: primaryFold,
		rootPlaces: places,
		rootProducts: products,
	});
	const passes = buildRootPasses(primaryFold);
	const universe = primaryFold.universe?.entry;

	const config: Config = { environments };
	if (passes !== undefined) {
		config.passes = passes;
	}

	if (places !== undefined) {
		config.places = places;
	}

	if (products !== undefined) {
		config.products = products;
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

interface MissingResourceInputs {
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
	readonly primary: ResolvedPrimary;
}

interface KeyedAsymmetrySpec {
	readonly bedrockPrefix: string;
	readonly mantlePrefix: string;
	readonly readKeys: (fold: EnvironmentFoldResult) => ReadonlyArray<string>;
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

const KEYED_ASYMMETRY_SPECS: ReadonlyArray<KeyedAsymmetrySpec> = [
	{
		bedrockPrefix: "places",
		mantlePrefix: "place_",
		readKeys: (fold) => [...fold.places.keys()],
	},
	{
		bedrockPrefix: "passes",
		mantlePrefix: "pass_",
		readKeys: (fold) => fold.passes.map(({ key }) => key),
	},
	{
		bedrockPrefix: "products",
		mantlePrefix: "product_",
		readKeys: (fold) => fold.products.map(({ key }) => key),
	},
];

function keyedAsymmetryWarnings(
	context: AsymmetryContext,
	spec: KeyedAsymmetrySpec,
): ReadonlyArray<MigrationWarning> {
	return asymmetricKeys(spec.readKeys(context.fold), spec.readKeys(context.primary)).map(
		(key) => {
			return missingResourceWarning({
				bedrockSegment: `${spec.bedrockPrefix}.${key}`,
				environmentName: context.environmentName,
				mantleSegment: `${spec.mantlePrefix}${key}`,
			});
		},
	);
}

function collectMissingResourceWarnings(
	inputs: MissingResourceInputs,
): ReadonlyArray<MigrationWarning> {
	const primaryFold = inputs.primary.fold;
	return [...inputs.folds.entries()].flatMap(([name, fold]): ReadonlyArray<MigrationWarning> => {
		const context: AsymmetryContext = { environmentName: name, fold, primary: primaryFold };
		return [
			...universeAsymmetryWarnings(context),
			...KEYED_ASYMMETRY_SPECS.flatMap((spec) => keyedAsymmetryWarnings(context, spec)),
		];
	});
}
