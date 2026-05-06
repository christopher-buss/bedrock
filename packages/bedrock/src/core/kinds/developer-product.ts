import type { Result } from "@bedrock-rbx/ocale";

import { type } from "arktype";

import { asResourceKey } from "../../types/ids.ts";
import type { DeveloperProductDesiredInput } from "../flatten.ts";
import { hashIconLocales, iconHashesEqual, iconMap } from "../icons.ts";
import type { DeveloperProductDesiredState, ResourceCurrentState } from "../resources.ts";
import { OPTIONAL_ROBUX_PRICE, type ResolvedConfig } from "../schema.ts";
import type { BuildDesiredError, KindIo, ResourceKindModule } from "./module.ts";

const OPTIONAL_BOOLEAN = "boolean | undefined";

const entrySchema = type({
	"name": "string",
	"description": "string",
	"icon?": iconMap,
	"isRegionalPricingEnabled?": OPTIONAL_BOOLEAN,
	"price?": OPTIONAL_ROBUX_PRICE,
	"storePageEnabled?": OPTIONAL_BOOLEAN,
});

function flatten(config: ResolvedConfig): ReadonlyArray<DeveloperProductDesiredInput> {
	return Object.entries(config.products ?? {}).map<DeveloperProductDesiredInput>(
		([key, entry]) => {
			const base: DeveloperProductDesiredInput = {
				key: asResourceKey(key),
				name: entry.name,
				description: entry.description,
				isRegionalPricingEnabled: entry.isRegionalPricingEnabled,
				kind: "developerProduct",
				price: entry.price,
				storePageEnabled: entry.storePageEnabled,
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
		isRegionalPricingEnabled: input.isRegionalPricingEnabled,
		kind: "developerProduct",
		price: input.price,
		storePageEnabled: input.storePageEnabled,
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
	// `isRegionalPricingEnabled` and `storePageEnabled` are tri-state:
	// `undefined` on the desired side means the user does not manage the
	// field, so any current value is accepted as a match.
	return (
		desired.description === current.description &&
		desired.icon?.["en-us"] === current.icon?.["en-us"] &&
		iconHashesEqual(current.iconFileHashes, desired.iconFileHashes) &&
		desired.name === current.name &&
		desired.price === current.price &&
		(desired.isRegionalPricingEnabled === undefined ||
			desired.isRegionalPricingEnabled === current.isRegionalPricingEnabled) &&
		(desired.storePageEnabled === undefined ||
			desired.storePageEnabled === current.storePageEnabled)
	);
}

function assertReconcilable(
	current: ResourceCurrentState<"developerProduct">,
	desired: DeveloperProductDesiredState,
): Result<undefined, BuildDesiredError> {
	if (current.iconFileHashes !== undefined && desired.iconFileHashes === undefined) {
		return {
			err: {
				key: desired.key,
				kind: "iconRemovalRejected",
				message: `developer product '${desired.key}' had an icon recorded in state, but the desired entry no longer declares one. The Roblox developer-product API has no documented way to unset an icon; remove the resource entry to delete the product, or restore the icon path to keep the existing image.`,
			},
			success: false,
		};
	}

	return { data: undefined, success: true };
}

/**
 * Resource-kind module for Roblox developer products. Owns the entry
 * schema, flattening, icon-hash normalization, drift-equality, and the
 * plan-time icon-removal rejection for the `developerProduct` kind.
 */
export const developerProductKind: ResourceKindModule<"developerProduct"> = {
	assertReconcilable,
	entrySchema,
	fieldsEqual,
	flatten,
	kind: "developerProduct",
	normalize,
};
