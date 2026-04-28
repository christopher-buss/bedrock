import type { Result } from "@bedrock/ocale";

import { type } from "arktype";

import { asResourceKey } from "../../types/ids.ts";
import type { GamePassDesiredInput } from "../flatten.ts";
import { hashIconLocales, iconHashesEqual, iconMap } from "../icons.ts";
import type { GamePassDesiredState, ResourceCurrentState } from "../resources.ts";
import { OPTIONAL_ROBUX_PRICE, type ResolvedConfig } from "../schema.ts";
import type { BuildDesiredError, KindIo, ResourceKindModule } from "./module.ts";

const entrySchema = type({
	"name": "string",
	"description": "string",
	"icon": iconMap,
	"price?": OPTIONAL_ROBUX_PRICE,
});

function flatten(config: ResolvedConfig): ReadonlyArray<GamePassDesiredInput> {
	return Object.entries(config.passes ?? {}).map<GamePassDesiredInput>(([key, entry]) => {
		return {
			key: asResourceKey(key),
			name: entry.name,
			description: entry.description,
			icon: entry.icon,
			kind: "gamePass",
			price: entry.price,
		};
	});
}

async function normalize(
	input: GamePassDesiredInput,
	io: KindIo,
): Promise<Result<GamePassDesiredState, BuildDesiredError>> {
	const hashes = await hashIconLocales({ key: input.key, icon: input.icon }, io);
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
			kind: "gamePass",
			price: input.price,
		},
		success: true,
	};
}

function fieldsEqual(
	desired: GamePassDesiredState,
	current: ResourceCurrentState<"gamePass">,
): boolean {
	return (
		desired.description === current.description &&
		desired.icon["en-us"] === current.icon["en-us"] &&
		iconHashesEqual(desired.iconFileHashes, current.iconFileHashes) &&
		desired.name === current.name &&
		desired.price === current.price
	);
}

/**
 * Resource-kind module for Roblox game passes. Owns the entry schema,
 * flattening, icon-hash normalization, and drift-equality for the
 * `gamePass` kind.
 */
export const gamePassKind: ResourceKindModule<"gamePass"> = {
	entrySchema,
	fieldsEqual,
	flatten,
	kind: "gamePass",
	normalize,
};
