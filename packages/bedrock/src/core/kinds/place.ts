import type { Result } from "@bedrock-rbx/ocale";

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

type PlaceMetadataField = (typeof PLACE_MANAGED_METADATA_FIELDS)[number];

/** Managed metadata fields with their non-`undefined` declared values. */
type PlaceMetadataPatch = {
	readonly [Field in PlaceMetadataField]?: NonNullable<PlaceDesiredState[Field]>;
};

/**
 * Select the managed metadata fields (`displayName`, `description`,
 * `serverSize`) the driver must `PATCH` to converge `current` onto `desired`.
 * A field is emitted only when it is declared (`!== undefined`) and either no
 * `current` is known (a create, where every declared field must be pushed) or
 * its value differs from the recorded state. Both drift detection
 * ({@link changedFieldsBetween}) and the place driver's `updateMask` builder
 * route through this single predicate so the two cannot diverge.
 *
 * @param desired - Desired place state from the resolved config.
 * @param current - Last-known state, or `undefined` on create.
 * @returns Partial state holding only the metadata fields to patch, in the
 *   fixed `PLACE_MANAGED_METADATA_FIELDS` order.
 */
export function changedPlaceMetadata(
	desired: PlaceDesiredState,
	current?: ResourceCurrentState<"place">,
): PlaceMetadataPatch {
	return PLACE_MANAGED_METADATA_FIELDS.reduce<PlaceMetadataPatch>((accumulator, field) => {
		const value = desired[field];
		if (value === undefined || value === current?.[field]) {
			return accumulator;
		}

		return { ...accumulator, [field]: value };
	}, {});
}

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

function changedFieldsBetween(
	desired: PlaceDesiredState,
	current: ResourceCurrentState<"place">,
): ReadonlyArray<string> {
	return [
		...(desired.fileHash === current.fileHash ? [] : ["fileHash"]),
		...(desired.filePath === current.filePath ? [] : ["filePath"]),
		...(desired.placeId === current.placeId ? [] : ["placeId"]),
		...Object.keys(changedPlaceMetadata(desired, current)),
	];
}

function fieldsEqual(desired: PlaceDesiredState, current: ResourceCurrentState<"place">): boolean {
	return changedFieldsBetween(desired, current).length === 0;
}

/**
 * Resource-kind module for Roblox places. Owns the entry schema,
 * flattening, file-hash normalization, and drift-equality for the `place`
 * kind.
 */
export const placeKind: ResourceKindModule<"place"> = {
	changedFieldsBetween,
	entrySchema,
	fieldsEqual,
	flatten,
	kind: "place",
	normalize,
};
