import type { Result } from "@bedrock/ocale";

import { type } from "arktype";

import { asResourceKey } from "../../types/ids.ts";
import type { DeveloperProductDesiredInput } from "../flatten.ts";
import { hashIconLocales, iconMap } from "../icons.ts";
import type { DeveloperProductDesiredState, ResourceCurrentState } from "../resources.ts";
import { OPTIONAL_ROBUX_PRICE, type ResolvedConfig } from "../schema.ts";
import type { BuildDesiredError, KindIo, ResourceKindModule } from "./module.ts";

const entrySchema = type({
	"name": "string",
	"description": "string",
	"icon?": iconMap,
	"price?": OPTIONAL_ROBUX_PRICE,
});

function flatten(config: ResolvedConfig): ReadonlyArray<DeveloperProductDesiredInput> {
	return Object.entries(config.products ?? {}).map<DeveloperProductDesiredInput>(
		([key, entry]) => {
			const base: DeveloperProductDesiredInput = {
				key: asResourceKey(key),
				name: entry.name,
				description: entry.description,
				kind: "developerProduct",
				price: entry.price,
			};
			return entry.icon === undefined ? base : { ...base, icon: entry.icon };
		},
	);
}

async function normalize(
	input: DeveloperProductDesiredInput,
	io: KindIo,
): Promise<Result<DeveloperProductDesiredState, BuildDesiredError>> {
	const base: DeveloperProductDesiredState = {
		key: input.key,
		name: input.name,
		description: input.description,
		kind: "developerProduct",
		price: input.price,
	};

	if (input.icon === undefined) {
		return { data: base, success: true };
	}

	const hashes = await hashIconLocales({ key: input.key, icon: input.icon }, io);
	if (!hashes.success) {
		return hashes;
	}

	return {
		data: { ...base, icon: input.icon, iconFileHashes: hashes.data },
		success: true,
	};
}

function fieldsEqual(
	desired: DeveloperProductDesiredState,
	current: ResourceCurrentState<"developerProduct">,
): boolean {
	return (
		desired.description === current.description &&
		desired.name === current.name &&
		desired.price === current.price
	);
}

/**
 * Resource-kind module for Roblox developer products. Owns the entry
 * schema, flattening, icon-hash normalization, and drift-equality for the
 * `developerProduct` kind.
 */
export const developerProductKind: ResourceKindModule<"developerProduct"> = {
	entrySchema,
	fieldsEqual,
	flatten,
	kind: "developerProduct",
	normalize,
};
