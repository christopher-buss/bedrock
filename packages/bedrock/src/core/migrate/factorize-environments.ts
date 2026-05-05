import type { Result } from "@bedrock/ocale";

import type {
	Config,
	DeveloperProductEntry,
	EnvironmentEntry,
	GamePassEntry,
	PlaceEntry,
} from "../schema.ts";
import { computeEnvironmentLabel } from "./environment-label.ts";
import { extractDisplayNamePrefix } from "./extract-display-name-prefix.ts";
import { collectMissingResourceWarnings } from "./factorize-environments-warnings.ts";
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
	readonly labels: ReadonlyMap<string, string | undefined>;
	readonly primary: EnvironmentFoldResult | undefined;
	readonly rootPlaces: Record<string, PlaceEntry> | undefined;
	readonly rootProducts: Record<string, DeveloperProductEntry> | undefined;
}

interface EnvironmentEntryInputs {
	readonly context: OverlayContext;
	readonly fold: EnvironmentFoldResult;
	readonly label: string | undefined;
}

interface BuildConfigInputs {
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
	readonly primaryFold: EnvironmentFoldResult;
	readonly primaryName: string;
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
			config: buildConfig({
				folds: inputs.folds,
				primaryFold: primary.fold,
				primaryName: primary.name,
			}),
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

function buildEnvironmentEntry(inputs: EnvironmentEntryInputs): EnvironmentEntry {
	const { context, fold, label } = inputs;
	const passes = buildPassesOverlay(fold, context.primary);
	const places = buildPlacesOverlay({ fold, label, rootPlaces: context.rootPlaces });
	const products = buildProductsOverlay(fold, context.rootProducts);
	const universe = buildUniverseOverlay(fold, context.primary);
	return {
		...(label !== undefined && { label }),
		...(passes !== undefined && { passes }),
		...(places !== undefined && { places }),
		...(products !== undefined && { products }),
		...(universe !== undefined && { universe }),
	};
}

function buildEnvironmentEntries(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	context: OverlayContext,
): Record<string, EnvironmentEntry> {
	return Object.fromEntries(
		[...folds].map(([name, fold]) => [
			name,
			buildEnvironmentEntry({ context, fold, label: context.labels.get(name) }),
		]),
	);
}

function buildEnvironmentLabels(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
): ReadonlyMap<string, string | undefined> {
	return new Map([...folds].map(([name, fold]) => [name, computeEnvironmentLabel(fold)]));
}

function resolveRootUniverse(
	primaryFold: EnvironmentFoldResult,
	label: string | undefined,
): Config["universe"] {
	const entry = primaryFold.universe?.entry;
	if (entry === undefined || label === undefined || entry.displayName === undefined) {
		return entry;
	}

	return { ...entry, displayName: extractDisplayNamePrefix(entry.displayName).body };
}

function buildConfig(inputs: BuildConfigInputs): Config {
	const { folds, primaryFold, primaryName } = inputs;
	const labels = buildEnvironmentLabels(folds);
	const places = buildRootPlaces({ folds, labels, primaryFold });
	const products = buildRootProducts(folds, primaryFold);
	const environments = buildEnvironmentEntries(folds, {
		labels,
		primary: primaryFold,
		rootPlaces: places,
		rootProducts: products,
	});
	const passes = buildRootPasses(primaryFold);
	const universe = resolveRootUniverse(primaryFold, labels.get(primaryName));
	return {
		environments,
		...(passes !== undefined && { passes }),
		...(places !== undefined && { places }),
		...(products !== undefined && { products }),
		...(universe !== undefined && { universe }),
	};
}
