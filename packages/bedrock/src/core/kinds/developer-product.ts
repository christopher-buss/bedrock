import type { Result } from "@bedrock/ocale";

import { type } from "arktype";

import { asResourceKey } from "../../types/ids.ts";
import type { DeveloperProductDesiredInput } from "../flatten.ts";
import type { DeveloperProductDesiredState, ResourceCurrentState } from "../resources.ts";
import type { ResolvedConfig } from "../schema.ts";
import type { BuildDesiredError, ResourceKindModule } from "./module.ts";

const entrySchema = type({
	name: "string",
	description: "string",
});

function flatten(config: ResolvedConfig): ReadonlyArray<DeveloperProductDesiredInput> {
	return Object.entries(config.products ?? {}).map<DeveloperProductDesiredInput>(
		([key, entry]) => {
			return {
				key: asResourceKey(key),
				name: entry.name,
				description: entry.description,
				kind: "developerProduct",
			};
		},
	);
}

async function normalize(
	input: DeveloperProductDesiredInput,
): Promise<Result<DeveloperProductDesiredState, BuildDesiredError>> {
	return {
		data: {
			key: input.key,
			name: input.name,
			description: input.description,
			kind: "developerProduct",
		},
		success: true,
	};
}

function fieldsEqual(
	desired: DeveloperProductDesiredState,
	current: ResourceCurrentState<"developerProduct">,
): boolean {
	return desired.description === current.description && desired.name === current.name;
}

/**
 * Resource-kind module for Roblox developer products. Owns the entry
 * schema, flattening, drift-equality, and the (slice-1 trivial) normalize
 * step for the `developerProduct` kind. Subsequent slices widen the entry
 * schema with `iconFilePath`, `price`, `isRegionalPricingEnabled`, and
 * `storePageEnabled`.
 */
export const developerProductKind: ResourceKindModule<"developerProduct"> = {
	entrySchema,
	fieldsEqual,
	flatten,
	kind: "developerProduct",
	normalize,
};
