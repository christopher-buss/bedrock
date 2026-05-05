import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { MigrationWarning } from "./migration-report.ts";

const RESOURCE_MISSING_RULE = "factorize-environments/resource-missing-from-env";

/**
 * Inputs to {@link collectMissingResourceWarnings}.
 */
export interface MissingResourceInputs {
	/** Per-environment fold results, keyed by environment name. */
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
	/** The chosen primary environment, used as the symmetry baseline. */
	readonly primary: { readonly fold: EnvironmentFoldResult; readonly name: string };
}

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

interface KeyedAsymmetrySpec {
	readonly bedrockPrefix: string;
	readonly mantlePrefix: string;
	readonly readKeys: (fold: EnvironmentFoldResult) => ReadonlyArray<string>;
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

/**
 * Walk every environment fold and emit one `interpretive` warning per
 * resource the environment lacks relative to the chosen primary, and per
 * resource the environment introduces that the primary lacks. The walk
 * covers the universe singleton plus every keyed kind in
 * {@link KEYED_ASYMMETRY_SPECS}.
 *
 * @param inputs - Per-environment folds and the resolved primary.
 * @returns Flat list of resource-asymmetry warnings.
 */
export function collectMissingResourceWarnings(
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

function missingResourceWarning(paths: MissingResourcePaths): MigrationWarning {
	return {
		bedrockPath: `environments.${paths.environmentName}.${paths.bedrockSegment}`,
		kind: "interpretive",
		mantlePath: `${paths.environmentName}.${paths.mantleSegment}`,
		rule: RESOURCE_MISSING_RULE,
	};
}

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
