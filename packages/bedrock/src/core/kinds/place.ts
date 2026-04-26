import type { Result } from "@bedrock/ocale";

import { type } from "arktype";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import type { PlaceDesiredInput } from "../flatten.ts";
import type { PlaceDesiredState, ResourceCurrentState } from "../resources.ts";
import type { ResolvedConfig } from "../schema.ts";
import { sha256Hex } from "./hash.ts";
import type { BuildDesiredError, KindIo, ResourceKindModule } from "./module.ts";
import { readBytes } from "./read-bytes.ts";

const entrySchema = type({
	filePath: "string",
	placeId: "string.digits",
}).onUndeclaredKey("reject");

function flatten(config: ResolvedConfig): ReadonlyArray<PlaceDesiredInput> {
	return Object.entries(config.places ?? {}).map<PlaceDesiredInput>(([key, entry]) => {
		return {
			key: asResourceKey(key),
			filePath: entry.filePath,
			kind: "place",
			placeId: asRobloxAssetId(entry.placeId),
		};
	});
}

async function normalize(
	input: PlaceDesiredInput,
	io: KindIo,
): Promise<Result<PlaceDesiredState, BuildDesiredError>> {
	const read = await readBytes({ key: input.key, filePath: input.filePath }, io);
	if (!read.success) {
		return read;
	}

	return {
		data: {
			key: input.key,
			fileHash: asSha256Hex(await sha256Hex(read.data)),
			filePath: input.filePath,
			kind: "place",
			placeId: input.placeId,
		},
		success: true,
	};
}

function fieldsEqual(desired: PlaceDesiredState, current: ResourceCurrentState<"place">): boolean {
	return (
		desired.fileHash === current.fileHash &&
		desired.filePath === current.filePath &&
		desired.placeId === current.placeId
	);
}

/**
 * Resource-kind module for Roblox places. Owns the entry schema,
 * flattening, file-hash normalization, and drift-equality for the `place`
 * kind.
 */
export const placeKind: ResourceKindModule<"place"> = {
	entrySchema,
	fieldsEqual,
	flatten,
	kind: "place",
	normalize,
};
