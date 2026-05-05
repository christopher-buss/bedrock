import { isSha256Hex, type Sha256Hex } from "../../types/ids.ts";
import type { PlaceOutputs } from "../resources.ts";
import type { PlaceEntry } from "../schema.ts";
import { foldBlockedPlaceFields } from "./fold-blocked-place-fields.ts";
import { interpretiveWarning } from "./fold-universe-shared.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

const PLACE_KIND = "place";
const PLACE_FILE_KIND = "placeFile";
const PLACE_CONFIGURATION_KIND = "placeConfiguration";

/**
 * Folded place data for one Mantle resource key.
 *
 * `entry` populates the bedrock root `Config.places.<key>` block (currently
 * just `filePath`). `placeId` is the Roblox-assigned place ID Mantle stored
 * under `place_<k>.outputs.assetId`; the migrator threads it onto the
 * matching per-environment overlay (`environments[env].places.<key>`).
 * `fileHash` is the SHA-256 digest Mantle recorded under
 * `placeFile_<k>.inputs.fileHash`; the shell consumes it as the fallback
 * value when the migrator cannot recompute the hash from disk. `outputs`
 * carries the auto-incrementing publish version number Mantle stored under
 * `placeFile_<k>.outputs.version`.
 */
export interface PlaceFoldEntry {
	/** Bedrock root `Config.places.<key>` body (currently `filePath` only). */
	readonly entry: PlaceEntry;
	/** Mantle-recorded SHA-256 hex digest of the place file (fallback for hash recomputation). */
	readonly fileHash: Sha256Hex;
	/** Roblox-assigned identifiers carried into `BedrockState.resources[*].outputs`. */
	readonly outputs: PlaceOutputs;
	/** Roblox-assigned place ID copied from `place_<key>.outputs.assetId`. */
	readonly placeId: string;
}

/**
 * Output of folding the place-related Mantle resources of one environment
 * into bedrock's `places` shape. Each Mantle place key produces one entry
 * in `entries`; orphans (a `place_<k>` without a `placeFile_<k>`, or vice
 * versa) emit one `ambiguous` warning each instead of being projected into
 * `entries`.
 */
interface PlaceFoldResult {
	/** Folded entries keyed by Mantle's place key (the suffix after the first `_`). */
	readonly entries: ReadonlyMap<string, PlaceFoldEntry>;
	/** Per-rule diagnostics: orphan resources surface as `ambiguous` warnings. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

interface PlaceOutputsRaw {
	readonly assetId: string;
}

interface PlaceFileInputsRaw {
	readonly fileHash: Sha256Hex;
	readonly filePath: string;
}

interface PlaceFileOutputsRaw {
	readonly version: number;
}

interface PlaceConfigFoldResult {
	readonly entry: PlaceFoldEntry;
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

interface ApplyPlaceConfigFieldsInputs {
	readonly key: string;
	readonly configResource: MantleResource | undefined;
	readonly folded: PlaceFoldEntry;
}

/**
 * Fold the place-related Mantle resources of one environment into a map of
 * `PlaceFoldEntry` plus accompanying warnings. Pairs each `place_<k>`
 * with the matching `placeFile_<k>` by key; an unmatched resource on
 * either side emits an `ambiguous` warning carrying the orphan's
 * `mantlePath` and a hint instructing the user to verify their Mantle
 * state.
 *
 * Matched pairs whose payloads fail shape validation (missing or
 * non-numeric `assetId`, missing `filePath`, malformed `fileHash`, etc.)
 * are dropped silently rather than surfacing as warnings, mirroring the
 * malformed-input handling in `foldUniverse`. A `malformed` warning kind
 * spanning the per-kind folds is left to a follow-up slice.
 *
 * @param resources - Mantle resource list for one environment.
 * @returns The folded entries plus orphan warnings.
 */
export function foldPlaces(resources: ReadonlyArray<MantleResource>): PlaceFoldResult {
	const { placeConfigurations, placeFiles, places } = bucketByKind(resources);
	const entries = new Map<string, PlaceFoldEntry>();
	const warnings: Array<MigrationWarning> = [];

	for (const [key, placeResource] of places) {
		const fileResource = placeFiles.get(key);
		if (fileResource === undefined) {
			warnings.push(orphanWarning(PLACE_KIND, key));
			continue;
		}

		const folded = mergeMatchedPair(placeResource, fileResource);
		if (folded === undefined) {
			continue;
		}

		const configFold = applyPlaceConfigFields({
			key,
			configResource: placeConfigurations.get(key),
			folded,
		});
		entries.set(key, configFold.entry);
		warnings.push(...configFold.warnings);
	}

	for (const [key] of placeFiles) {
		if (!places.has(key)) {
			warnings.push(orphanWarning(PLACE_FILE_KIND, key));
		}
	}

	return { entries, warnings: [...warnings, ...foldBlockedPlaceFields(resources)] };
}

function bucketByKind(resources: ReadonlyArray<MantleResource>): {
	readonly placeConfigurations: Map<string, MantleResource>;
	readonly placeFiles: Map<string, MantleResource>;
	readonly places: Map<string, MantleResource>;
} {
	const places = new Map<string, MantleResource>();
	const placeFiles = new Map<string, MantleResource>();
	const placeConfigurations = new Map<string, MantleResource>();
	for (const resource of resources) {
		switch (resource.kind) {
			case PLACE_CONFIGURATION_KIND: {
				placeConfigurations.set(resource.key, resource);

				break;
			}
			case PLACE_FILE_KIND: {
				placeFiles.set(resource.key, resource);

				break;
			}
			case PLACE_KIND: {
				places.set(resource.key, resource);

				break;
			}
			// No default
		}
	}

	return { placeConfigurations, placeFiles, places };
}

function isObjectPayload(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyPlaceConfigFields(inputs: ApplyPlaceConfigFieldsInputs): PlaceConfigFoldResult {
	const { key, configResource, folded } = inputs;
	if (configResource === undefined || !isObjectPayload(configResource.inputs)) {
		return { entry: folded, warnings: [] };
	}

	const { description } = configResource.inputs;
	if (typeof description !== "string") {
		return { entry: folded, warnings: [] };
	}

	return {
		entry: { ...folded, entry: { ...folded.entry, description } },
		warnings: [
			interpretiveWarning({
				bedrockPath: `places.${key}.description`,
				mantlePath: `${PLACE_CONFIGURATION_KIND}_${key}.description`,
				rule: "place-description",
			}),
		],
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

function readPlaceOutputs(resource: MantleResource): PlaceOutputsRaw | undefined {
	const { outputs } = resource;
	if (!isObjectPayload(outputs)) {
		return undefined;
	}

	const assetId = coerceRobloxId(outputs["assetId"]);
	if (assetId === undefined) {
		return undefined;
	}

	return { assetId };
}

function readPlaceFileInputs(resource: MantleResource): PlaceFileInputsRaw | undefined {
	const { inputs } = resource;
	if (!isObjectPayload(inputs)) {
		return undefined;
	}

	const { fileHash, filePath } = inputs;
	if (typeof filePath !== "string" || typeof fileHash !== "string" || !isSha256Hex(fileHash)) {
		return undefined;
	}

	return { fileHash, filePath };
}

function readPlaceFileOutputs(resource: MantleResource): PlaceFileOutputsRaw | undefined {
	const { outputs } = resource;
	if (!isObjectPayload(outputs)) {
		return undefined;
	}

	const { version } = outputs;
	if (typeof version !== "number") {
		return undefined;
	}

	return { version };
}

function mergeMatchedPair(
	placeResource: MantleResource,
	fileResource: MantleResource,
): PlaceFoldEntry | undefined {
	const placeOutputs = readPlaceOutputs(placeResource);
	const fileInputs = readPlaceFileInputs(fileResource);
	const fileOutputs = readPlaceFileOutputs(fileResource);
	if (placeOutputs === undefined || fileInputs === undefined || fileOutputs === undefined) {
		return undefined;
	}

	return {
		entry: { filePath: fileInputs.filePath },
		fileHash: fileInputs.fileHash,
		outputs: { versionNumber: fileOutputs.version },
		placeId: placeOutputs.assetId,
	};
}

function orphanWarning(kind: string, key: string): MigrationWarning {
	return {
		hint: "Verify your Mantle state file: each place_<k> resource must be paired with a matching placeFile_<k>, and vice versa.",
		kind: "ambiguous",
		mantlePath: `${kind}_${key}`,
	};
}
