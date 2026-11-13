import type { Result } from "@bedrock-rbx/ocale";

import {
	asResourceKey,
	asRobloxAssetId,
	type ResourceKey,
	type RobloxAssetId,
} from "../types/ids.ts";
import type { BuildDesiredError } from "./kinds/module.ts";
import { type ResourceLiveState, resourceRobloxId } from "./live-state.ts";
import type { GamePassDesiredState, ResourceCurrentState, ResourceKind } from "./resources.ts";
import type { ResolvedConfig } from "./schema.ts";

/** One `importId` line an Environment overlay declares. */
export interface ImportDeclaration {
	/** Config Key the live item is recorded under. */
	readonly key: ResourceKey;
	/** Whether `iconBaseline: "accept-local-file"` accompanies the id. */
	readonly acceptLocalIcon: boolean;
	/** Environment whose overlay declares the import. */
	readonly environment: string;
	/** Kind of the declaring collection. */
	readonly kind: "gamePass";
	/** Roblox id of the live item. */
	readonly robloxId: RobloxAssetId;
}

interface Refusal {
	readonly err: BuildDesiredError;
	readonly success: false;
}

const KIND_NAMES: Readonly<Record<ResourceKind, string>> = {
	badge: "badge",
	developerProduct: "developer product",
	gamePass: "game pass",
	place: "place",
	universe: "universe",
};

/**
 * Collect the imports one Environment overlay declares.
 *
 * @param config - Config holding every Environment overlay.
 * @param environment - The Environment being reconciled.
 * @returns One declaration per overlay entry with an `importId`.
 */
export function collectImports(
	config: Pick<ResolvedConfig, "environments">,
	environment: string,
): ReadonlyArray<ImportDeclaration> {
	const passes = config.environments[environment]?.passes ?? {};
	return Object.entries(passes).flatMap(([key, entry]) => {
		if (entry.importId === undefined) {
			return [];
		}

		return [
			{
				key: asResourceKey(key),
				acceptLocalIcon: entry.iconBaseline === "accept-local-file",
				environment,
				kind: "gamePass" as const,
				robloxId: asRobloxAssetId(entry.importId),
			},
		];
	});
}

/**
 * Keep the declarations still to import, refusing an id another Key holds or
 * a Key whose State holds another id. A Key whose State already tracks its
 * declared id was imported by an earlier run.
 *
 * @param declarations - Imports the Environment declares.
 * @param resources - Saved Current state of the Environment.
 * @returns The declarations to read, or the first refusal.
 */
export function pendingImports(
	declarations: ReadonlyArray<ImportDeclaration>,
	resources: ReadonlyArray<ResourceCurrentState>,
): Result<ReadonlyArray<ImportDeclaration>, BuildDesiredError> {
	const pending: Array<ImportDeclaration> = [];
	for (const declaration of declarations) {
		const holders = [
			...resources
				.filter((resource) => resource.kind === declaration.kind)
				.map((resource) => ({ key: resource.key, robloxId: resourceRobloxId(resource) })),
			...pending,
		];
		const saved = holders.find(({ key }) => key === declaration.key);
		if (saved?.robloxId === declaration.robloxId) {
			continue;
		}

		if (saved !== undefined) {
			return rejected(
				declaration,
				`cannot be imported: '${declaration.key}' already has State.`,
			);
		}

		const owner = holders.find(({ robloxId }) => robloxId === declaration.robloxId);
		if (owner !== undefined) {
			return rejected(declaration, `cannot be imported: '${owner.key}' already tracks it.`);
		}

		pending.push(declaration);
	}

	return { data: pending, success: true };
}

/**
 * Refuse an import whose id the declaring Kind could not read.
 *
 * @param declaration - The import that found no live item.
 * @param otherKind - Another Kind that holds the id, when one does.
 * @returns The refusal naming the declaring line.
 */
export function importNotLive(
	declaration: ImportDeclaration,
	otherKind: ResourceKind | undefined,
): Refusal {
	return rejected(
		declaration,
		otherKind === undefined
			? `is not a live ${KIND_NAMES[declaration.kind]} in this Environment's universe.`
			: `is a ${KIND_NAMES[otherKind]}, not a ${KIND_NAMES[declaration.kind]}.`,
	);
}

/**
 * Refuse an import that no Driver can read.
 *
 * @param declaration - The import that could not be read.
 * @returns The refusal naming the declaring line.
 */
export function importUnreadable(declaration: ImportDeclaration): Refusal {
	return rejected(declaration, "cannot be read: importing needs an Open Cloud credential.");
}

/**
 * Record a live item as the Current state of the Key importing it. Live
 * values replace config values, so the Diff that follows plans any
 * difference as an update. The local icon path and hash come from Desired
 * state, accepted only when the declaration trusts the local file.
 *
 * @param declaration - The import being recorded.
 * @param observed - Desired state of the Key and the item's Live state.
 * @param observed.desired - Desired state of the importing Key.
 * @param observed.live - Live state read from Roblox.
 * @returns The imported Current state, or the refusal naming the line.
 */
export function importedCurrent(
	declaration: ImportDeclaration,
	{
		desired,
		live,
	}: {
		readonly desired: GamePassDesiredState;
		readonly live: ResourceLiveState<"gamePass">;
	},
): Result<ResourceCurrentState<"gamePass">, BuildDesiredError> {
	const { kind: _kind, outputs, ...fields } = live;
	if (!declaration.acceptLocalIcon || outputs.iconAssetIds === undefined) {
		return rejected(
			declaration,
			'has no known icon hash: supply the icon file and add iconBaseline: "accept-local-file" beside importId.',
		);
	}

	return {
		data: {
			...desired,
			...fields,
			outputs: { assetId: declaration.robloxId, iconAssetIds: outputs.iconAssetIds },
		},
		success: true,
	};
}

function rejected({ key, environment, robloxId }: ImportDeclaration, reason: string): Refusal {
	return {
		err: {
			key,
			kind: "importRejected",
			message: `environments.${environment}.passes.${key}.importId "${robloxId}" ${reason}`,
		},
		success: false,
	};
}
