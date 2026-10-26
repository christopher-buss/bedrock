import type { Result } from "@bedrock-rbx/ocale";

import { type } from "arktype";

import { asResourceKey } from "../../types/ids.ts";
import type { GamePassDesiredInput, RetiredInput } from "../flatten.ts";
import { hashIconLocalesAsync, iconHashesEqual, iconMap } from "../icons.ts";
import type { GamePassDesiredState, ResourceCurrentState } from "../resources.ts";
import { OPTIONAL_ROBUX_PRICE, type ResolvedConfig } from "../schema.ts";
import type { BuildDesiredError, KindIo, ResourceKindModule } from "./module.ts";

const entrySchema = type({
	"name": "string",
	"description": "string",
	"icon": iconMap,
	"isManagedPricingEnabled?": "boolean",
	"price?": OPTIONAL_ROBUX_PRICE,
	"redacted?": "boolean | undefined",
});

function flatten(
	config: ResolvedConfig,
): ReadonlyArray<GamePassDesiredInput | (RetiredInput & { kind: "gamePass" })> {
	return Object.entries(config.passes ?? {}).map<
		GamePassDesiredInput | (RetiredInput & { kind: "gamePass" })
	>(([key, entry]) => {
		if ("retired" in entry) {
			return { key: asResourceKey(key), kind: "gamePass", retired: entry.retired };
		}

		return {
			key: asResourceKey(key),
			...(entry.movedFrom === undefined ? {} : { movedFrom: entry.movedFrom }),
			name: entry.name,
			description: entry.description,
			icon: entry.icon,
			isManagedPricingEnabled: entry.isManagedPricingEnabled ?? false,
			kind: "gamePass",
			price: entry.price,
		};
	});
}

async function normalizeAsync(
	input: GamePassDesiredInput,
	io: KindIo,
): Promise<Result<GamePassDesiredState, BuildDesiredError>> {
	const hashes = await hashIconLocalesAsync({ key: input.key, icon: input.icon }, io);
	if (!hashes.success) {
		return hashes;
	}

	return {
		data: {
			key: input.key,
			name: input.name,
			description: input.description,
			icon: input.icon,
			iconFileHashes: hashes.data,
			isManagedPricingEnabled: input.isManagedPricingEnabled ?? false,
			kind: "gamePass",
			price: input.price,
		},
		success: true,
	};
}

function changedFieldsBetween(
	desired: GamePassDesiredState,
	current: ResourceCurrentState<"gamePass">,
): ReadonlyArray<string> {
	return [
		...(desired.description === current.description ? [] : ["description"]),
		...(desired.icon["en-us"] === current.icon["en-us"] ? [] : ["icon"]),
		...(iconHashesEqual(current.iconFileHashes, desired.iconFileHashes)
			? []
			: ["iconFileHashes"]),
		...(desired.name === current.name ? [] : ["name"]),
		...((desired.isManagedPricingEnabled ?? false) ===
		(current.isManagedPricingEnabled ?? false)
			? []
			: ["isManagedPricingEnabled"]),
		...(desired.price === current.price ? [] : ["price"]),
	];
}

function fieldsEqual(
	desired: GamePassDesiredState,
	current: ResourceCurrentState<"gamePass">,
): boolean {
	return changedFieldsBetween(desired, current).length === 0;
}

/**
 * Resource-kind module for Roblox game passes. Owns the entry schema,
 * flattening, icon-hash normalization, and drift-equality for the
 * `gamePass` kind.
 */
export const gamePassKind: ResourceKindModule<"gamePass"> = {
	assertRetirable() {
		return { data: undefined, success: true };
	},
	changedFieldsBetween,
	entrySchema,
	fieldsEqual,
	flatten,
	kind: "gamePass",
	normalize: normalizeAsync,
};
