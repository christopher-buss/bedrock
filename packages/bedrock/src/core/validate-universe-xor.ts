import type { EnvironmentEntry, UniverseEntry } from "./schema.ts";

/**
 * Loose authored-shape that the runtime narrow operates on before the
 * config gets cast to the discriminated `Config` union. Mirrors the
 * arktype schema's inferred shape: every field is structurally a
 * supertype of every `Config` variant arm, so the narrow can run before
 * the XOR rule has discriminated the value into one arm.
 */
interface LooseConfigForValidation {
	readonly environments: Record<string, EnvironmentEntry>;
	readonly universe?: UniverseEntry;
}

interface UniverseIdIssue {
	readonly message: string;
	readonly path: ReadonlyArray<string>;
}

/**
 * Walk the loose authored-shape and surface every place the
 * universeId-XOR-between-root-and-env rule is violated. Pure: returns
 * the issue list; the caller hands it to arktype's `ctx.reject` so each
 * one lands at the offending config path. The schema's runtime narrow
 * uses this to enforce the rule at validation time before the validated
 * value is cast to the strict `Config` discriminated union.
 *
 * @param value - Parsed config the schema is validating.
 * @returns Zero or more issues. Empty when the config satisfies the rule.
 */
export function collectUniverseIdIssues(
	value: LooseConfigForValidation,
): ReadonlyArray<UniverseIdIssue> {
	const rootUniverseId = value.universe?.universeId;
	const hasRootUniverseBlock = value.universe !== undefined;
	const environmentEntries = Object.entries(value.environments);
	const hasEnvironmentUniverseId = environmentEntries.some(
		([, environment]) => environment.universe?.universeId !== undefined,
	);

	const environmentIssues = collectEnvironmentIssues(rootUniverseId, environmentEntries);
	const rootIssues =
		hasRootUniverseBlock && rootUniverseId === undefined && !hasEnvironmentUniverseId
			? [
					{
						message:
							"universeId must be declared on the root universe block, or on every environment that declares its own universe overlay.",
						path: ["universe", "universeId"],
					},
				]
			: [];

	return [...environmentIssues, ...rootIssues];
}

function collectEnvironmentIssues(
	rootUniverseId: string | undefined,
	environmentEntries: ReadonlyArray<readonly [string, EnvironmentEntry]>,
): ReadonlyArray<UniverseIdIssue> {
	return environmentEntries.flatMap(([environmentName, environment]) => {
		if (environment.universe === undefined) {
			return [];
		}

		if (rootUniverseId !== undefined && environment.universe.universeId !== undefined) {
			return [
				{
					message:
						"universeId is declared at the root universe block; remove it from this environment overlay (root is authoritative) or remove it from the root and declare it on every environment.",
					path: ["environments", environmentName, "universe", "universeId"],
				},
			];
		}

		if (rootUniverseId === undefined && environment.universe.universeId === undefined) {
			return [
				{
					message:
						"universeId must be declared on this environment overlay because the root universe block does not provide one.",
					path: ["environments", environmentName, "universe", "universeId"],
				},
			];
		}

		return [];
	});
}
