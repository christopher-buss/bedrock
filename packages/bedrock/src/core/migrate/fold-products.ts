import { asResourceKey, asRobloxAssetId, asSha256Hex, isSha256Hex } from "../../types/ids.ts";
import type { ResourceKey, Sha256Hex } from "../../types/ids.ts";
import type { DeveloperProductOutputs } from "../resources.ts";
import type { DeveloperProductEntry } from "../schema.ts";
import { coerceRobloxId, isObjectPayload } from "./fold-universe-shared.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

const PRODUCT_KIND = "product";
const PRODUCT_ICON_KIND = "productIcon";

/**
 * Folded representation of one Mantle `product_<k>` resource.
 *
 * `entry` carries the bedrock `Config.products[<k>]` shape; when a matching
 * `productIcon_<k>` resource is present it also carries the locale-keyed icon
 * path. `outputs` carries the Roblox-assigned identifiers for the product and
 * its optional icon. `mantleIconFileHashes` preserves the hash recorded by
 * Mantle so the shell can fall back to it when the icon file is missing on
 * disk; absent when no icon partner is found. `mantlePath` roots warnings at
 * the resource so the report is searchable.
 */
export interface ProductFoldEntry {
	/** User-supplied Mantle key, branded as a bedrock `ResourceKey`. */
	readonly key: ResourceKey;
	/** Bedrock `Config.products[<k>]` block populated from the product resource. */
	readonly entry: DeveloperProductEntry;
	/** Locale-keyed Mantle-recorded icon hashes; absent when no productIcon partner is paired. */
	readonly mantleIconFileHashes?: Record<"en-us", Sha256Hex>;
	/** Resource-rooted Mantle path (`product_<k>`) used to anchor warnings. */
	readonly mantlePath: string;
	/** Roblox-assigned identifiers carried into `BedrockState.resources[*].outputs`. */
	readonly outputs: DeveloperProductOutputs;
}

/**
 * Output of folding the `product_<k>` and `productIcon_<k>` Mantle resources
 * of one environment into bedrock-shaped developer-product entries.
 *
 * `products` carries one record per well-formed `product_<k>` resource;
 * malformed resources are dropped silently. `warnings` carries one
 * `ambiguous` warning per orphan `productIcon_<k>` (no matching product).
 */
interface ProductsFoldResult {
	/** One folded entry per well-formed Mantle `product_<k>` resource. */
	readonly products: ReadonlyArray<ProductFoldEntry>;
	/** Per-rule diagnostics: orphan productIcon resources surface as `ambiguous` warnings. */
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

interface ProductIconInputs {
	readonly fileHash: Sha256Hex;
	readonly filePath: string;
}

interface ProductIconOutputsRaw {
	readonly assetId: string;
}

interface ProductIconParts {
	readonly icon: Record<"en-us", string>;
	readonly iconImageAssetId: string;
	readonly mantleIconFileHashes: Record<"en-us", Sha256Hex>;
}

/**
 * Fold the `product_<k>` (and matching `productIcon_<k>`) Mantle resources
 * of one environment into a list of bedrock developer-product entries plus
 * matching outputs. Pairs each `product_<k>` with the optional
 * `productIcon_<k>` resource sharing the same key; when the icon partner is
 * present and well-formed, the locale-keyed icon path lands on the entry
 * and the Roblox-assigned `iconImageAssetId` lands on the outputs.
 *
 * Resources whose payload is malformed (non-object, missing required string
 * field, missing `productId`, malformed `fileHash`) are dropped silently.
 * Orphan `productIcon_<k>` resources (no matching product) emit one
 * `ambiguous` warning each.
 *
 * @param resources - Resource list for one Mantle environment.
 * @returns The folded product entries plus per-rule diagnostics.
 */
export function foldProducts(resources: ReadonlyArray<MantleResource>): ProductsFoldResult {
	const { productIcons, products } = bucketByKind(resources);
	const folded = products.flatMap((resource): ReadonlyArray<ProductFoldEntry> => {
		const iconResource = productIcons.get(resource.key);
		const entry = foldOneProduct(resource, iconResource);
		return entry === undefined ? [] : [entry];
	});

	const productKeys = new Set(products.map((resource) => resource.key));
	const warnings = [...productIcons.keys()]
		.filter((key) => !productKeys.has(key))
		.map((key) => orphanIconWarning(key));

	return { products: folded, warnings };
}

function bucketByKind(resources: ReadonlyArray<MantleResource>): {
	readonly productIcons: Map<string, MantleResource>;
	readonly products: ReadonlyArray<MantleResource>;
} {
	const products: Array<MantleResource> = [];
	const productIcons = new Map<string, MantleResource>();
	for (const resource of resources) {
		if (resource.kind === PRODUCT_KIND) {
			products.push(resource);
		} else if (resource.kind === PRODUCT_ICON_KIND) {
			productIcons.set(resource.key, resource);
		}
	}

	return { productIcons, products };
}

function buildEntry(
	inputs: ProductInputs,
	icon: Record<"en-us", string> | undefined,
): DeveloperProductEntry {
	const base: DeveloperProductEntry = {
		name: inputs.name,
		description: inputs.description,
	};
	const withPrice = inputs.price === undefined ? base : { ...base, price: inputs.price };
	return icon === undefined ? withPrice : { ...withPrice, icon };
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

function readProductIconInputs(raw: unknown): ProductIconInputs | undefined {
	if (!isObjectPayload(raw)) {
		return undefined;
	}

	const filePath = readString(raw["filePath"]);
	const fileHash = readString(raw["fileHash"]);
	if (filePath === undefined || fileHash === undefined || !isSha256Hex(fileHash)) {
		return undefined;
	}

	return { fileHash: asSha256Hex(fileHash), filePath };
}

function readProductIconOutputs(raw: unknown): ProductIconOutputsRaw | undefined {
	if (!isObjectPayload(raw)) {
		return undefined;
	}

	const assetId = coerceRobloxId(raw["assetId"]);
	if (assetId === undefined) {
		return undefined;
	}

	return { assetId };
}

function readProductIconParts(resource: MantleResource): ProductIconParts | undefined {
	const inputs = readProductIconInputs(resource.inputs);
	const outputs = readProductIconOutputs(resource.outputs);
	if (inputs === undefined || outputs === undefined) {
		return undefined;
	}

	return {
		icon: { "en-us": inputs.filePath },
		iconImageAssetId: outputs.assetId,
		mantleIconFileHashes: { "en-us": inputs.fileHash },
	};
}

function foldOneProduct(
	resource: MantleResource,
	iconResource: MantleResource | undefined,
): ProductFoldEntry | undefined {
	const inputs = readProductInputs(resource.inputs);
	if (inputs === undefined) {
		return undefined;
	}

	const outputs = readProductOutputs(resource.outputs);
	if (outputs === undefined) {
		return undefined;
	}

	const iconParts = iconResource === undefined ? undefined : readProductIconParts(iconResource);
	const productOutputs: DeveloperProductOutputs =
		iconParts === undefined
			? { iconImageAssetId: undefined, productId: asRobloxAssetId(outputs.productId) }
			: {
					iconImageAssetId: asRobloxAssetId(iconParts.iconImageAssetId),
					productId: asRobloxAssetId(outputs.productId),
				};

	const base: ProductFoldEntry = {
		key: asResourceKey(resource.key),
		entry: buildEntry(inputs, iconParts?.icon),
		mantlePath: `${PRODUCT_KIND}_${resource.key}`,
		outputs: productOutputs,
	};

	return iconParts === undefined
		? base
		: { ...base, mantleIconFileHashes: iconParts.mantleIconFileHashes };
}

function orphanIconWarning(key: string): MigrationWarning {
	return {
		hint: "Verify your Mantle state file: each productIcon_<k> resource must be paired with a matching product_<k>.",
		kind: "ambiguous",
		mantlePath: `${PRODUCT_ICON_KIND}_${key}`,
	};
}
