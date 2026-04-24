import type { Result } from "@bedrock/ocale";

import { type } from "arktype";

import { asRobloxAssetId } from "../../types/ids.ts";
import type { UniverseDesiredInput } from "../flatten.ts";
import {
	type ResourceCurrentState,
	UNIVERSE_SINGLETON_KEY,
	type UniverseDesiredState,
} from "../resources.ts";
import type { BuildDesiredError, ResourceKindModule } from "./module.ts";

const entrySchema = type({
	"universeId": "string.digits",
	"voiceChatEnabled?": "boolean | undefined",
}).onUndeclaredKey("reject");

interface UniverseEntryLike {
	readonly universeId: string;
	readonly voiceChatEnabled?: boolean | undefined;
}

function flatten(config: {
	readonly universe?: UniverseEntryLike;
}): ReadonlyArray<UniverseDesiredInput> {
	const entry = config.universe;
	if (entry === undefined) {
		return [];
	}

	return [
		{
			key: UNIVERSE_SINGLETON_KEY,
			kind: "universe",
			universeId: asRobloxAssetId(entry.universeId),
			voiceChatEnabled: entry.voiceChatEnabled,
		},
	];
}

async function normalize(
	input: UniverseDesiredInput,
): Promise<Result<UniverseDesiredState, BuildDesiredError>> {
	return {
		data: {
			key: input.key,
			kind: "universe",
			universeId: input.universeId,
			voiceChatEnabled: input.voiceChatEnabled,
		},
		success: true,
	};
}

function fieldsEqual(
	desired: UniverseDesiredState,
	current: ResourceCurrentState<"universe">,
): boolean {
	return (
		desired.universeId === current.universeId &&
		desired.voiceChatEnabled === current.voiceChatEnabled
	);
}

/**
 * Resource-kind module for the singleton Roblox universe. Owns the entry
 * schema, flattening, pass-through normalize (no file I/O), and
 * drift-equality for the `universe` kind.
 */
export const universeKind: ResourceKindModule<"universe"> = {
	entrySchema,
	fieldsEqual,
	flatten,
	kind: "universe",
	normalize,
};
