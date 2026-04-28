import type { Result } from "@bedrock/ocale";

import { type } from "arktype";

import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import type { PlaceDesiredInput } from "../flatten.ts";
import { PLACE_MANAGED_METADATA_FIELDS } from "../resources.ts";
import type { PlaceDesiredState, ResourceCurrentState } from "../resources.ts";
import { OPTIONAL_POSITIVE_INTEGER } from "../schema.ts";
import type { ResolvedConfig } from "../schema.ts";
import { sha256Hex } from "./hash.ts";
import type { BuildDesiredError, KindIo, ResourceKindModule } from "./module.ts";
import { readBytes } from "./read-bytes.ts";

const entrySchema = type({
	"description?": "string | undefined",
	"displayName?": "string | undefined",
	"filePath": "string",
	"placeId": "string.digits",
	"serverSize?": OPTIONAL_POSITIVE_INTEGER,
}).onUndeclaredKey("reject");

function flatten(config: ResolvedConfig): ReadonlyArray<PlaceDesiredInput> {
	return Object.entries(config.places ?? {}).map<PlaceDesiredInput>(([key, entry]) => {
		return {
			key: asResourceKey(key),
			description: entry.description,
			displayName: entry.displayName,
			filePath: entry.filePath,
			kind: "place",
			placeId: asRobloxAssetId(entry.placeId),
			serverSize: entry.serverSize,
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
			description: input.description,
			displayName: input.displayName,
			fileHash: asSha256Hex(await sha256Hex(read.data)),
			filePath: input.filePath,
			kind: "place",
			placeId: input.placeId,
			serverSize: input.serverSize,
		},
		success: true,
	};
}

function fieldsEqual(desired: PlaceDesiredState, current: ResourceCurrentState<"place">): boolean {
	if (
		desired.fileHash !== current.fileHash ||
		desired.filePath !== current.filePath ||
		desired.placeId !== current.placeId
	) {
		return false;
	}

	return PLACE_MANAGED_METADATA_FIELDS.every((field) => {
		const desiredValue = desired[field];
		return desiredValue === undefined || desiredValue === current[field];
	});
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
