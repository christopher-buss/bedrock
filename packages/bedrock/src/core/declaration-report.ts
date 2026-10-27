import type { ResourceKind } from "./resources.ts";
import type { Config, EnvironmentEntry } from "./schema.ts";
import type { BedrockState } from "./state.ts";

/**
 * Last-known persisted status of one temporary config declaration. A line is
 * safe to drop only when both environment lists are empty. An overlay's
 * `environment` identifies where the line was authored; all environments are
 * still checked for the same kind and old key.
 *
 * @since unreleased
 *
 * @example
 * ```ts
 * import type { DeclarationReport } from "@bedrock-rbx/core";
 * const report: DeclarationReport = {
 *     declaration: "movedFrom", resourceKind: "gamePass",
 *     key: "vip-plus", oldKey: "vip",
 *     activeEnvironments: ["staging"], unknownEnvironments: [],
 * };
 * expect(report.oldKey).toBe("vip");
 * expect(report.activeEnvironments).toEqual(["staging"]);
 * ```
 */
export interface DeclarationReport {
	/** Resource key on which the declaration is authored. */
	readonly key: string;
	/** Environments whose persisted state still holds the old identity. */
	readonly activeEnvironments: ReadonlyArray<string>;
	/** Config field whose declaration is being checked. */
	readonly declaration: "movedFrom" | "retired";
	/** Overlay containing the declaration; absent for a root declaration. */
	readonly environment?: string;
	/** Previous identity to look for, within `resourceKind`. */
	readonly oldKey: string;
	/** Kind of the declared resource. */
	readonly resourceKind: ResourceKind;
	/** Environments whose persisted state could not be read. */
	readonly unknownEnvironments: ReadonlyArray<string>;
}

type Declaration = Pick<
	DeclarationReport,
	"declaration" | "environment" | "key" | "oldKey" | "resourceKind"
>;

/**
 * Collect authored lines, retaining their root or overlay scope.
 * @param config - The authored project, before environment merging.
 * @returns Temporary declarations with their authoring locations.
 */
export function collectDeclarations(config: Config): ReadonlyArray<Declaration> {
	const environments: Record<string, EnvironmentEntry> = config.environments;
	return [
		...declarationsIn(config),
		...Object.entries(environments).flatMap(([environment, entry]) => {
			return overlayDeclarationsIn(entry).map((declaration) => {
				return { ...declaration, environment };
			});
		}),
	];
}

/**
 * Compare declarations with persisted snapshots, never planned operations.
 * @param declarations - Authored lines to inspect.
 * @param observations - Persisted snapshots and environments that could not be read.
 * @returns One status report per declaration.
 */
export function buildDeclarationReports(
	declarations: ReadonlyArray<Declaration>,
	{
		states,
		unknownEnvironments,
	}: {
		readonly states: ReadonlyMap<string, BedrockState | undefined>;
		readonly unknownEnvironments: ReadonlyArray<string>;
	},
): ReadonlyArray<DeclarationReport> {
	return declarations.map((declaration) => {
		return {
			...declaration,
			activeEnvironments: [...states]
				.filter(([, state]) => {
					return (
						state?.resources.some((resource) => {
							return (
								resource.kind === declaration.resourceKind &&
								resource.key === declaration.oldKey
							);
						}) === true
					);
				})
				.map(([environment]) => environment),
			unknownEnvironments,
		};
	});
}

function inCollection(
	resourceKind: ResourceKind,
	entries:
		| Readonly<Record<string, { readonly movedFrom?: string } | { readonly retired: unknown }>>
		| undefined,
): ReadonlyArray<Declaration> {
	return Object.entries(entries ?? {}).flatMap<Declaration>(([key, entry]) => {
		if ("retired" in entry) {
			return [{ key, declaration: "retired", oldKey: key, resourceKind }];
		}

		return entry.movedFrom === undefined
			? []
			: [{ key, declaration: "movedFrom", oldKey: entry.movedFrom, resourceKind }];
	});
}

function declarationsIn(config: Config): ReadonlyArray<Declaration> {
	return [
		...inCollection("gamePass", config.passes),
		...inCollection("developerProduct", config.products),
		...inCollection("place", config.places),
	];
}

function retiredIn(
	resourceKind: ResourceKind,
	entries: Readonly<Record<string, object>> | undefined,
): ReadonlyArray<Declaration> {
	return Object.entries(entries ?? {}).flatMap<Declaration>(([key, entry]) => {
		return "retired" in entry
			? [{ key, declaration: "retired", oldKey: key, resourceKind }]
			: [];
	});
}

function overlayDeclarationsIn(environment: EnvironmentEntry): ReadonlyArray<Declaration> {
	return [
		...retiredIn("gamePass", environment.passes),
		...retiredIn("developerProduct", environment.products),
		...retiredIn("place", environment.places),
	];
}
