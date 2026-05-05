import { isSha256Hex, type Sha256Hex } from "../../types/ids.ts";
import type { PlaceOutputs } from "../resources.ts";
import type { PlaceEntry } from "../schema.ts";
import { foldBlockedPlaceFields } from "./fold-blocked-place-fields.ts";
import { interpretiveWarning, isObjectPayload } from "./fold-universe-shared.ts";
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
	readonly isStart: boolean;
}

interface PlaceConfigFragmentRule {
	readonly bedrockField: string;
	readonly mantleField: string;
	readonly rule: string;
}

interface PlaceConfigFragment {
	readonly entry: Partial<PlaceEntry>;
	readonly warnings: ReadonlyArray<PlaceConfigFragmentRule>;
}

interface PlaceConfigRule {
	readonly bedrockField: keyof PlaceEntry;
	readonly mantleField: string;
	readonly read: (value: unknown) => number | string | undefined;
	readonly rule: string;
}

interface PlaceBuckets {
	readonly placeConfigurations: Map<string, MantleResource>;
	readonly placeFiles: Map<string, MantleResource>;
	readonly places: Map<string, MantleResource>;
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
	const buckets = bucketByKind(resources);
	const matched = collectMatchedFolds(buckets);
	const orphans = collectOrphanWarnings(buckets);
	return {
		entries: matched.entries,
		warnings: [...matched.warnings, ...orphans, ...foldBlockedPlaceFields(resources)],
	};
}

function collectMatchedFolds(buckets: PlaceBuckets): PlaceFoldResult {
	const { placeConfigurations, placeFiles, places } = buckets;
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
			isStart: isStartPlace(placeResource),
		});
		entries.set(key, configFold.entry);
		warnings.push(...configFold.warnings);
	}

	return { entries, warnings };
}

function collectOrphanWarnings(buckets: PlaceBuckets): ReadonlyArray<MigrationWarning> {
	const { placeConfigurations, placeFiles, places } = buckets;
	const warnings: Array<MigrationWarning> = [];
	for (const [key] of placeFiles) {
		if (!places.has(key)) {
			warnings.push(orphanWarning(PLACE_FILE_KIND, key));
		}
	}

	for (const [key] of placeConfigurations) {
		if (!places.has(key) || !placeFiles.has(key)) {
			warnings.push(placeConfigOrphanWarning(key));
		}
	}

	return warnings;
}

function bucketByKind(resources: ReadonlyArray<MantleResource>): PlaceBuckets {
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

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		return undefined;
	}

	return value;
}

const ALWAYS_RULES: ReadonlyArray<PlaceConfigRule> = [
	{
		bedrockField: "description",
		mantleField: "description",
		read: readString,
		rule: "place-description",
	},
	{
		bedrockField: "serverSize",
		mantleField: "maxPlayerCount",
		read: readPositiveInteger,
		rule: "max-player-count-to-server-size",
	},
];

const NON_START_RULES: ReadonlyArray<PlaceConfigRule> = [
	{
		bedrockField: "displayName",
		mantleField: "name",
		read: readString,
		rule: "place-name-to-display-name",
	},
];

function placeConfigRules(isStart: boolean): ReadonlyArray<PlaceConfigRule> {
	return isStart ? ALWAYS_RULES : [...ALWAYS_RULES, ...NON_START_RULES];
}

function readPlaceConfigFragment(
	inputs: Record<string, unknown>,
	rules: ReadonlyArray<PlaceConfigRule>,
): PlaceConfigFragment {
	return rules.reduce<{
		entry: Partial<PlaceEntry>;
		warnings: Array<PlaceConfigFragmentRule>;
	}>(
		(accumulator, rule) => {
			const value = rule.read(inputs[rule.mantleField]);
			if (value === undefined) {
				return accumulator;
			}

			return {
				entry: { ...accumulator.entry, [rule.bedrockField]: value },
				warnings: [
					...accumulator.warnings,
					{
						bedrockField: rule.bedrockField,
						mantleField: rule.mantleField,
						rule: rule.rule,
					},
				],
			};
		},
		{ entry: {}, warnings: [] },
	);
}

function applyPlaceConfigFields(inputs: ApplyPlaceConfigFieldsInputs): PlaceConfigFoldResult {
	const { key, configResource, folded, isStart } = inputs;
	if (configResource === undefined || !isObjectPayload(configResource.inputs)) {
		return { entry: folded, warnings: [] };
	}

	const fragment = readPlaceConfigFragment(configResource.inputs, placeConfigRules(isStart));
	const entry: PlaceFoldEntry = {
		...folded,
		entry: { ...folded.entry, ...fragment.entry },
	};

	return {
		entry,
		warnings: fragment.warnings.map((rule) => {
			return interpretiveWarning({
				bedrockPath: `places.${key}.${rule.bedrockField}`,
				mantlePath: `${PLACE_CONFIGURATION_KIND}_${key}.${rule.mantleField}`,
				rule: rule.rule,
			});
		}),
	};
}

function isStartPlace(resource: MantleResource): boolean {
	if (!isObjectPayload(resource.inputs)) {
		return false;
	}

	return resource.inputs["isStart"] === true;
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

function placeConfigOrphanWarning(key: string): MigrationWarning {
	return {
		hint: "Verify your Mantle state file: each placeConfiguration_<k> requires a matching place_<k>+placeFile_<k> pair to fold its data into the bedrock config.",
		kind: "ambiguous",
		mantlePath: `${PLACE_CONFIGURATION_KIND}_${key}`,
	};
}
