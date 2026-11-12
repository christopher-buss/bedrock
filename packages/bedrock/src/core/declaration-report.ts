import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import { resourceRobloxId } from "./live-state.ts";
import type { ResourceKind } from "./resources.ts";
import type { Config, EnvironmentEntry } from "./schema.ts";
import type { BedrockState } from "./state.ts";

/**
 * Last-known persisted status of one temporary config declaration. A line is
 * safe to drop only when both environment lists are empty. An overlay's
 * `environment` identifies where the line was authored. `movedFrom` and
 * `retired` lines check every environment for the same kind and old key.
 * `importId` and `iconBaseline` lines check only their own environment, and
 * are still needed there until its persisted state holds the key.
 *
 * @since 0.4.0
 *
 * @example
 * ```ts
 * import { asResourceKey, type DeclarationReport } from "@bedrock-rbx/core";
 * const report: DeclarationReport = {
 *     declaration: "movedFrom", resourceKind: "gamePass",
 *     key: asResourceKey("vip-plus"), oldKey: asResourceKey("vip"),
 *     activeEnvironments: ["staging"], unknownEnvironments: [],
 * };
 * expect(report.oldKey).toBe("vip");
 * expect(report.activeEnvironments).toEqual(["staging"]);
 * ```
 */
export interface DeclarationReport {
	/** Resource key on which the declaration is authored. */
	readonly key: ResourceKey;
	/**
	 * Environments that still need the line: their persisted state still holds
	 * the old identity, or does not yet hold an imported key.
	 */
	readonly activeEnvironments: ReadonlyArray<string>;
	/** Config field whose declaration is being checked. */
	readonly declaration: "iconBaseline" | "importId" | "movedFrom" | "retired";
	/** Overlay containing the declaration; absent for a root declaration. */
	readonly environment?: string;
	/** Previous identity to look for, within `resourceKind`. */
	readonly oldKey: ResourceKey;
	/** Kind of the declared resource. */
	readonly resourceKind: ResourceKind;
	/** Environments whose persisted state could not be read. */
	readonly unknownEnvironments: ReadonlyArray<string>;
}

interface Imported {
	readonly environment: string;
	readonly robloxId: string;
}

interface Declaration extends Pick<
	DeclarationReport,
	"declaration" | "environment" | "key" | "oldKey" | "resourceKind"
> {
	/** Environment whose state must hold the key with this Roblox ID. */
	readonly imported?: Imported;
}

type Observations = Parameters<typeof buildDeclarationReports>[1];

const IMPORT_LINES = ["importId", "iconBaseline"] as const;

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
			return [
				...overlayDeclarationsIn(entry).map((declaration) => {
					return { ...declaration, environment };
				}),
				...importsIn(environment, entry),
			];
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
	return declarations.map(({ imported, ...declaration }) => {
		if (imported !== undefined) {
			return {
				...declaration,
				...importStatus({ ...declaration, imported }, { states, unknownEnvironments }),
			};
		}

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
	return Object.entries(entries ?? {}).flatMap<Declaration>(([name, entry]) => {
		const key = asResourceKey(name);
		if ("retired" in entry) {
			return [{ key, declaration: "retired", oldKey: key, resourceKind }];
		}

		return entry.movedFrom === undefined
			? []
			: [
					{
						key,
						declaration: "movedFrom",
						oldKey: asResourceKey(entry.movedFrom),
						resourceKind,
					},
				];
	});
}

function declarationsIn(config: Config): ReadonlyArray<Declaration> {
	return [
		...inCollection("gamePass", config.passes),
		...inCollection("developerProduct", config.products),
		...inCollection("place", config.places),
		...inCollection("badge", config.badges),
	];
}

function retiredIn(
	resourceKind: ResourceKind,
	entries: Readonly<Record<string, object>> | undefined,
): ReadonlyArray<Declaration> {
	return Object.entries(entries ?? {}).flatMap<Declaration>(([name, entry]) => {
		const key = asResourceKey(name);
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
		...retiredIn("badge", environment.badges),
	];
}

function importsIn(environment: string, overlay: EnvironmentEntry): ReadonlyArray<Declaration> {
	const collections: ReadonlyArray<
		readonly [ResourceKind, Readonly<Record<string, object>> | undefined]
	> = [
		["gamePass", overlay.passes],
		["developerProduct", overlay.products],
		["badge", overlay.badges],
	];
	return collections.flatMap(([resourceKind, entries]) => {
		return Object.entries(entries ?? {}).flatMap<Declaration>(([name, entry]) => {
			const fields = new Map(Object.entries(entry));
			const robloxId = fields.get("importId");
			if (typeof robloxId !== "string") {
				return [];
			}

			const key = asResourceKey(name);
			return IMPORT_LINES.filter((line) => fields.get(line) !== undefined).map((line) => {
				return {
					key,
					declaration: line,
					environment,
					imported: { environment, robloxId },
					oldKey: key,
					resourceKind,
				};
			});
		});
	});
}

function importStatus(
	{
		key,
		imported: { environment, robloxId },
		resourceKind,
	}: Pick<Declaration, "key" | "resourceKind"> & { readonly imported: Imported },
	{ states, unknownEnvironments }: Observations,
): Pick<DeclarationReport, "activeEnvironments" | "unknownEnvironments"> {
	if (unknownEnvironments.includes(environment)) {
		return { activeEnvironments: [], unknownEnvironments: [environment] };
	}

	const held = states.get(environment)?.resources.some((resource) => {
		return (
			resource.kind === resourceKind &&
			resource.key === key &&
			resourceRobloxId(resource) === robloxId
		);
	});
	return { activeEnvironments: held === true ? [] : [environment], unknownEnvironments: [] };
}
