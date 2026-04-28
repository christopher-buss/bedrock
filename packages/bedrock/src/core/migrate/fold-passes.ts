import { asResourceKey, asRobloxAssetId, asSha256Hex, isSha256Hex } from "../../types/ids.ts";
import type { ResourceKey, Sha256Hex } from "../../types/ids.ts";
import type { GamePassOutputs } from "../resources.ts";
import type { GamePassEntry } from "../schema.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

const PASS_KIND = "pass";

/**
 * Folded representation of one Mantle `pass_<k>` resource.
 *
 * `entry` carries the bedrock `Config.passes[<k>]` shape (omitting
 * `iconFileHashes` because the hashes are recomputed from disk by the shell
 * before they land on state). `outputs` carries the Roblox-assigned
 * identifiers for the pass and its icon. `mantleIconFileHashes` preserves
 * the hashes recorded by Mantle so the shell can fall back to them when the
 * icon file is missing on disk. `mantlePath` roots warnings at the
 * resource so the report is searchable.
 */
export interface PassFoldEntry {
	/** User-supplied Mantle key, branded as a bedrock `ResourceKey`. */
	readonly key: ResourceKey;
	/** Bedrock `Config.passes[<k>]` block populated from the pass resource. */
	readonly entry: GamePassEntry;
	/** Locale-keyed Mantle-recorded icon hashes; retained as a fallback for hash recomputation. */
	readonly mantleIconFileHashes: Record<"en-us", Sha256Hex>;
	/** Resource-rooted Mantle path (`pass_<k>`) used to anchor warnings. */
	readonly mantlePath: string;
	/** Roblox-assigned identifiers carried into `BedrockState.resources[*].outputs`. */
	readonly outputs: GamePassOutputs;
}

/**
 * Output of folding the `pass_<k>` Mantle resources of one environment
 * into bedrock-shaped game-pass entries.
 *
 * `passes` carries one record per well-formed `pass_<k>` resource;
 * malformed resources are dropped silently in this slice (warning-emitting
 * variants land alongside their consuming rules). `warnings` accumulates
 * per-rule diagnostics; the slice emits an empty list because no
 * interpretive rules have been wired yet.
 */
interface PassesFoldResult {
	/** One folded entry per well-formed Mantle `pass_<k>` resource. */
	readonly passes: ReadonlyArray<PassFoldEntry>;
	/** Per-rule diagnostics; empty in this slice, populated as rules land. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

interface PassInputs {
	readonly name: string;
	readonly description: string;
	readonly iconFileHash: Sha256Hex;
	readonly iconFilePath: string;
	readonly price: number | undefined;
}

interface PassOutputsRaw {
	readonly assetId: string;
	readonly iconAssetId: string;
}

/**
 * Fold the `pass_<k>` Mantle resources of one environment into a list
 * of bedrock game-pass entries plus matching outputs.
 *
 * Each well-formed `pass_<k>.inputs.{name, description, iconFilePath,
 * price}` becomes the corresponding `Config.passes[<k>]` entry; the
 * matching `pass_<k>.outputs.{assetId, iconAssetId}` becomes the
 * `BedrockState` resource's `outputs`. The Mantle-recorded
 * `iconFileHash` is preserved on the result so the shell can fall back
 * to it when the icon file is missing on disk.
 *
 * Resources whose payload is malformed (non-object, missing required
 * string field, non-`Sha256Hex` hash, missing output IDs) are dropped
 * silently in this slice; warning-emitting variants land alongside the
 * specific interpretive rules that need them.
 *
 * @param resources - Resource list for one Mantle environment.
 * @returns The folded pass entries plus an aggregated warnings list.
 */
export function foldPasses(resources: ReadonlyArray<MantleResource>): PassesFoldResult {
	const passes = resources.flatMap((resource): ReadonlyArray<PassFoldEntry> => {
		if (resource.kind !== PASS_KIND) {
			return [];
		}

		const folded = foldOnePass(resource);
		return folded === undefined ? [] : [folded];
	});

	return { passes, warnings: [] };
}

function buildEntry(inputs: PassInputs): GamePassEntry {
	const base = {
		name: inputs.name,
		description: inputs.description,
		icon: { "en-us": inputs.iconFilePath },
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

function readPassInputs(raw: unknown): PassInputs | undefined {
	if (!isObjectPayload(raw)) {
		return undefined;
	}

	const name = readString(raw["name"]);
	const description = readString(raw["description"]);
	const iconFilePath = readString(raw["iconFilePath"]);
	const iconFileHashRaw = readString(raw["iconFileHash"]);
	if (
		name === undefined ||
		description === undefined ||
		iconFilePath === undefined ||
		iconFileHashRaw === undefined ||
		!isSha256Hex(iconFileHashRaw)
	) {
		return undefined;
	}

	return {
		name,
		description,
		iconFileHash: asSha256Hex(iconFileHashRaw),
		iconFilePath,
		price: readPrice(raw),
	};
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

function readPassOutputs(raw: unknown): PassOutputsRaw | undefined {
	if (!isObjectPayload(raw)) {
		return undefined;
	}

	const assetId = coerceRobloxId(raw["assetId"]);
	const iconAssetId = coerceRobloxId(raw["iconAssetId"]);
	if (assetId === undefined || iconAssetId === undefined) {
		return undefined;
	}

	return { assetId, iconAssetId };
}

function foldOnePass(resource: MantleResource): PassFoldEntry | undefined {
	const inputs = readPassInputs(resource.inputs);
	if (inputs === undefined) {
		return undefined;
	}

	const outputs = readPassOutputs(resource.outputs);
	if (outputs === undefined) {
		return undefined;
	}

	return {
		key: asResourceKey(resource.key),
		entry: buildEntry(inputs),
		mantleIconFileHashes: { "en-us": inputs.iconFileHash },
		mantlePath: `${PASS_KIND}_${resource.key}`,
		outputs: {
			assetId: asRobloxAssetId(outputs.assetId),
			iconAssetIds: { "en-us": asRobloxAssetId(outputs.iconAssetId) },
		},
	};
}
