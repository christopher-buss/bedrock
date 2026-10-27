import type { Result } from "@bedrock-rbx/ocale";

import type { ResourceKey } from "../types/ids.ts";
import type { BuildDesiredError } from "./kinds/module.ts";
import { universeKind } from "./kinds/universe.ts";
import type { ResourceCurrentState, ResourceKind } from "./resources.ts";
import type { BedrockState } from "./state.ts";

interface Declaration {
	readonly key: ResourceKey;
	readonly kind: ResourceKind;
	readonly movedFrom?: string | undefined;
	readonly placeId?: string | undefined;
	readonly retired?: "untrack" | true;
}

type Baseline = Pick<BedrockState, "pendingRebuild" | "realDisplay" | "resources">;
type RenameError = Extract<BuildDesiredError, { kind: "renameRejected" }>;
type RetirementError = Extract<BuildDesiredError, { kind: "retirementRejected" }>;
type OrphanError = Extract<BuildDesiredError, { kind: "orphanRejected" }>;
type Rebound = Baseline & { readonly orphans: ReadonlyArray<ResourceCurrentState> };

/**
 * Adopt declared previous keys before pairing desired and current state.
 * The returned baseline is also persisted so noop renames retain identity.
 *
 * @param declarations - Full config identities, before artifact filtering.
 * @param prior - Current resources and their identity-keyed bookkeeping.
 * @returns The rebound baseline, or a rename conflict before any operation.
 */
export function rebindCurrent(
	declarations: ReadonlyArray<Declaration>,
	prior: Baseline & { readonly orphanPolicy?: "error" | "retire" | undefined },
): Result<Rebound, OrphanError | RenameError | RetirementError> {
	const retirement = assertRetirements(declarations, prior.resources);
	if (!retirement.success) {
		return retirement;
	}

	const moves = new Map<ResourceCurrentState, ResourceKey>();
	for (const entry of declarations) {
		const found =
			entry.movedFrom === undefined
				? implicitPlaceSource(entry, { current: prior.resources, declarations })
				: explicitSource(entry, prior.resources);
		if (!found.success) {
			return found;
		}

		if (found.data === undefined) {
			continue;
		}

		if (moves.has(found.data)) {
			return rejected(
				`Previous key '${found.data.key}' is claimed by both '${moves.get(found.data)}' and '${entry.key}'.`,
			);
		}

		moves.set(found.data, entry.key);
	}

	const resources = prior.resources.map((resource) => {
		const key = moves.get(resource);
		return key === undefined ? resource : { ...resource, key };
	});
	return validateOrphans(declarations, { ...prior, resources, ...rebindMetadata(prior, moves) });
}

function placeRetirementRefusal(
	place: ResourceCurrentState<"place">,
	{
		declarations,
		rootPlaceId,
	}: {
		readonly declarations: ReadonlyArray<Declaration>;
		readonly rootPlaceId: string | undefined;
	},
): string | undefined {
	if (rootPlaceId === place.placeId) {
		return `Cannot retire root place '${place.key}' (${place.placeId}): Roblox derives the experience name and description from it.`;
	}

	const adopted = declarations.find((desired) => desired.placeId === place.placeId);
	return adopted === undefined
		? undefined
		: `Cannot retire place '${place.key}' (${place.placeId}): it is still adopted by place '${adopted.key}'.`;
}

function assertPlaceRetirements(
	declarations: ReadonlyArray<Declaration>,
	current: ReadonlyArray<ResourceCurrentState>,
): Result<undefined, RetirementError> {
	const universe = current.find((resource) => resource.kind === "universe");
	for (const entry of declarations) {
		if (entry.kind !== "place" || entry.retired !== true) {
			continue;
		}

		const place = current.find(
			(resource) => resource.kind === "place" && resource.key === entry.key,
		);
		if (place?.kind !== "place") {
			continue;
		}

		const message = placeRetirementRefusal(place, {
			declarations,
			rootPlaceId: universe?.outputs.rootPlaceId,
		});
		if (message !== undefined) {
			return {
				err: {
					key: entry.key,
					kind: "retirementRejected",
					message,
				},
				success: false,
			};
		}
	}

	return { data: undefined, success: true };
}

function orphanRefusal(orphans: ReadonlyArray<ResourceCurrentState>): Result<never, OrphanError> {
	return {
		err: {
			kind: "orphanRejected",
			message: `Unresolved orphans: ${orphans
				.map((entry) => `${entry.kind}:${entry.key}`)
				.join(
					", ",
				)}. Restore each entry with retired: true to retire it, retired: "untrack" to stop managing it without changing Roblox, or movedFrom on its new entry to preserve its Roblox ID.`,
			orphans: orphans.map(({ key, kind }) => ({ key, kind })),
		},
		success: false,
	};
}

function validateOrphans(
	declarations: ReadonlyArray<Declaration>,
	baseline: Baseline & { readonly orphanPolicy?: "error" | "retire" | undefined },
): Result<Rebound, OrphanError | RetirementError> {
	const orphans = baseline.resources.filter((resource) => {
		return declarations.every(
			(entry) => entry.kind !== resource.kind || entry.key !== resource.key,
		);
	});
	if (baseline.orphanPolicy !== "retire" && orphans.length > 0) {
		return orphanRefusal(orphans);
	}

	const retirement = assertPlaceRetirements(
		[
			...declarations,
			...orphans.map(({ key, kind }) => {
				return { key, kind, retired: true as const };
			}),
		],
		baseline.resources,
	);
	return retirement.success ? { data: { ...baseline, orphans }, success: true } : retirement;
}

function assertRetirements(
	declarations: ReadonlyArray<Declaration>,
	current: ReadonlyArray<ResourceCurrentState>,
): Result<undefined, RetirementError> {
	const universe = current.find((resource) => resource.kind === "universe");
	if (universe !== undefined && declarations.every((entry) => entry.kind !== "universe")) {
		return universeKind.assertRetirable(universe.key);
	}

	return assertPlaceRetirements(declarations, current);
}

function rejected(message: string): { readonly err: RenameError; readonly success: false } {
	return { err: { kind: "renameRejected", message }, success: false };
}

function explicitSource(
	entry: Declaration,
	current: ReadonlyArray<ResourceCurrentState>,
): Result<ResourceCurrentState | undefined, RenameError> {
	const source = current.find(
		(resource) => resource.kind === entry.kind && resource.key === entry.movedFrom,
	);
	if (source === undefined) {
		const other = current.find((resource) => resource.key === entry.movedFrom);
		return other === undefined
			? { data: undefined, success: true }
			: rejected(
					`Cannot move '${entry.movedFrom}' (${other.kind}) to '${entry.key}' (${entry.kind}): movedFrom must name the same kind.`,
				);
	}

	if (current.some((resource) => resource.kind === entry.kind && resource.key === entry.key)) {
		return rejected(
			`Cannot move '${entry.movedFrom}' to '${entry.key}' (${entry.kind}): both keys have current state.`,
		);
	}

	return { data: source, success: true };
}

function implicitPlaceSource(
	entry: Declaration,
	{
		current,
		declarations,
	}: {
		readonly current: ReadonlyArray<ResourceCurrentState>;
		readonly declarations: ReadonlyArray<Declaration>;
	},
): Result<ResourceCurrentState | undefined, RenameError> {
	if (current.some((resource) => resource.kind === entry.kind && resource.key === entry.key)) {
		return { data: undefined, success: true };
	}

	const source = current.find((resource) => {
		return (
			resource.kind === "place" &&
			resource.placeId === entry.placeId &&
			declarations.every(
				(desired) => desired.kind !== "place" || desired.key !== resource.key,
			)
		);
	});
	return { data: source, success: true };
}

function rebindMetadata(
	prior: Baseline,
	moves: ReadonlyMap<ResourceCurrentState, ResourceKey>,
): Pick<Baseline, "pendingRebuild" | "realDisplay"> {
	const identities = new Map<string, string>();
	const places = new Map<ResourceKey, ResourceKey>();
	for (const [resource, key] of moves) {
		identities.set(`${resource.kind}:${resource.key}`, `${resource.kind}:${key}`);
		if (resource.kind === "place") {
			places.set(resource.key, key);
		}
	}

	const result: {
		pendingRebuild?: ReadonlySet<ResourceKey>;
		realDisplay?: NonNullable<BedrockState["realDisplay"]>;
	} = {};
	if (prior.pendingRebuild !== undefined) {
		result.pendingRebuild = new Set(
			Array.from(prior.pendingRebuild, (key) => places.get(key) ?? key),
		);
	}

	if (prior.realDisplay !== undefined) {
		result.realDisplay = Object.fromEntries(
			Object.entries(prior.realDisplay).map(([key, value]) => [
				identities.get(key) ?? key,
				value,
			]),
		);
	}

	return result;
}
