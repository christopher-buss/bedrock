import { asResourceKey, asRobloxAssetId } from "../../types/ids.ts";
import type { ResourceKey } from "../../types/ids.ts";
import type { DeveloperProductOutputs } from "../resources.ts";
import type { DeveloperProductEntry } from "../schema.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

const PRODUCT_KIND = "product";

/**
 * Folded representation of one Mantle `product_<k>` resource.
 *
 * `entry` carries the bedrock `Config.products[<k>]` shape (without an icon
 * in this slice; pairing with `productIcon_<k>` lands in a later slice).
 * `outputs` carries the Roblox-assigned identifier for the developer product.
 * `mantlePath` roots warnings at the resource so the report is searchable.
 */
export interface ProductFoldEntry {
	/** User-supplied Mantle key, branded as a bedrock `ResourceKey`. */
	readonly key: ResourceKey;
	/** Bedrock `Config.products[<k>]` block populated from the product resource. */
	readonly entry: DeveloperProductEntry;
	/** Resource-rooted Mantle path (`product_<k>`) used to anchor warnings. */
	readonly mantlePath: string;
	/** Roblox-assigned identifiers carried into `BedrockState.resources[*].outputs`. */
	readonly outputs: DeveloperProductOutputs;
}

/**
 * Output of folding the `product_<k>` Mantle resources of one environment
 * into bedrock-shaped developer-product entries.
 *
 * `products` carries one record per well-formed `product_<k>` resource;
 * malformed resources are dropped silently in this slice. `warnings`
 * accumulates per-rule diagnostics.
 */
interface ProductsFoldResult {
	/** One folded entry per well-formed Mantle `product_<k>` resource. */
	readonly products: ReadonlyArray<ProductFoldEntry>;
	/** Per-rule diagnostics; empty in this slice. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

interface ProductInputs {
	readonly name: string;
	readonly description: string;
	readonly price: number | undefined;
}

interface ProductOutputsRaw {
	readonly productId: string;
}

/**
 * Fold the `product_<k>` Mantle resources of one environment into a list
 * of bedrock developer-product entries plus matching outputs.
 *
 * Each well-formed `product_<k>.inputs.{name, description, price}` becomes
 * the corresponding `Config.products[<k>]` entry; the matching
 * `product_<k>.outputs.productId` becomes the `BedrockState` resource's
 * `outputs.productId`. Resources whose payload is malformed (non-object,
 * missing required string field, missing `productId`) are dropped silently
 * in this slice.
 *
 * @param resources - Resource list for one Mantle environment.
 * @returns The folded product entries plus an aggregated warnings list.
 */
export function foldProducts(resources: ReadonlyArray<MantleResource>): ProductsFoldResult {
	const products = resources.flatMap((resource): ReadonlyArray<ProductFoldEntry> => {
		if (resource.kind !== PRODUCT_KIND) {
			return [];
		}

		const folded = foldOneProduct(resource);
		return folded === undefined ? [] : [folded];
	});

	return { products, warnings: [] };
}

function buildEntry(inputs: ProductInputs): DeveloperProductEntry {
	const base: DeveloperProductEntry = {
		name: inputs.name,
		description: inputs.description,
	};

	return inputs.price === undefined ? base : { ...base, price: inputs.price };
}

function isObjectPayload(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readPrice(raw: Record<string, unknown>): number | undefined {
	const candidate = raw["price"];
	return typeof candidate === "number" ? candidate : undefined;
}

function readProductInputs(raw: unknown): ProductInputs | undefined {
	if (!isObjectPayload(raw)) {
		return undefined;
	}

	const name = readString(raw["name"]);
	const description = readString(raw["description"]);
	if (name === undefined || description === undefined) {
		return undefined;
	}

	return { name, description, price: readPrice(raw) };
}

function coerceRobloxId(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}

	if (Number.isInteger(value)) {
		return String(value);
	}

	return undefined;
}

function readProductOutputs(raw: unknown): ProductOutputsRaw | undefined {
	if (!isObjectPayload(raw)) {
		return undefined;
	}

	const productId = coerceRobloxId(raw["productId"]);
	if (productId === undefined) {
		return undefined;
	}

	return { productId };
}

function foldOneProduct(resource: MantleResource): ProductFoldEntry | undefined {
	const inputs = readProductInputs(resource.inputs);
	if (inputs === undefined) {
		return undefined;
	}

	const outputs = readProductOutputs(resource.outputs);
	if (outputs === undefined) {
		return undefined;
	}

	return {
		key: asResourceKey(resource.key),
		entry: buildEntry(inputs),
		mantlePath: `${PRODUCT_KIND}_${resource.key}`,
		outputs: { productId: asRobloxAssetId(outputs.productId) },
	};
}
