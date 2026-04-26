import type { Result } from "@bedrock/ocale";

import { type } from "arktype";

import { asResourceKey, asSha256Hex } from "../../types/ids.ts";
import type { GamePassDesiredInput } from "../flatten.ts";
import type { GamePassDesiredState, ResourceCurrentState } from "../resources.ts";
import type { ResolvedConfig } from "../schema.ts";
import { sha256Hex } from "./hash.ts";
import type { BuildDesiredError, KindIo, ResourceKindModule } from "./module.ts";
import { readBytes } from "./read-bytes.ts";

const entrySchema = type({
	"name": "string",
	"description": "string",
	"iconFilePath": "string",
	"price?": "number | undefined",
});

function flatten(config: ResolvedConfig): ReadonlyArray<GamePassDesiredInput> {
	return Object.entries(config.passes ?? {}).map<GamePassDesiredInput>(([key, entry]) => {
		return {
			key: asResourceKey(key),
			name: entry.name,
			description: entry.description,
			iconFilePath: entry.iconFilePath,
			kind: "gamePass",
			price: entry.price,
		};
	});
}

async function normalize(
	input: GamePassDesiredInput,
	io: KindIo,
): Promise<Result<GamePassDesiredState, BuildDesiredError>> {
	const read = await readBytes({ key: input.key, filePath: input.iconFilePath }, io);
	if (!read.success) {
		return read;
	}

	return {
		data: {
			key: input.key,
			name: input.name,
			description: input.description,
			iconFileHash: asSha256Hex(await sha256Hex(read.data)),
			iconFilePath: input.iconFilePath,
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
		desired.iconFileHash === current.iconFileHash &&
		desired.iconFilePath === current.iconFilePath &&
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
