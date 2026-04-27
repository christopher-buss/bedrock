import { asRobloxAssetId } from "../../types/ids.ts";
import type { UniverseOutputs } from "../resources.ts";
import type { UniverseEntry } from "../schema.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

const EXPERIENCE_KIND = "experience";

/**
 * Output of folding the experience-related Mantle resources of one
 * environment into Bedrock's `universe` shape.
 *
 * `entry` populates the bedrock `Config.universe` block. `outputs`
 * populates the matching `BedrockState` resource's `outputs` field.
 * `warnings` accumulates per-rule diagnostics; the skeleton emits an
 * empty list because no interpretive rules have landed yet.
 */
export interface UniverseFoldResult {
	/** Bedrock `Config.universe` block populated from the experience resource. */
	readonly entry: UniverseEntry;
	/** Roblox-assigned identifiers carried into `BedrockState.resources[*].outputs`. */
	readonly outputs: UniverseOutputs;
	/** Per-rule diagnostics; empty in the skeleton, populated as rules land. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

interface ExperienceOutputs {
	readonly assetId: string;
	readonly startPlaceId: string;
}

/**
 * Fold the universe-contributing Mantle resources of one environment
 * into a `UniverseEntry` plus matching `UniverseOutputs`.
 *
 * Skeleton: only the `experience_singleton` resource is consumed.
 * `experience.outputs.assetId` becomes `universe.universeId`;
 * `experience.outputs.startPlaceId` becomes the bedrock state's
 * `outputs.rootPlaceId`. Future slices fold `experienceConfiguration`,
 * `experienceActivation`, `spatialVoice`, `socialLink_*`, and the start
 * place's `placeConfiguration.name` into the same entry.
 *
 * Returns `undefined` when no `experience_singleton` resource is present;
 * the caller treats that as "this environment has no universe to migrate"
 * and omits the `universe` field from the resulting `Config`.
 *
 * @param resources - Resource list for one Mantle environment.
 * @returns The folded universe data plus warnings, or `undefined` when
 *   no `experience_singleton` is present.
 */
export function foldUniverse(
	resources: ReadonlyArray<MantleResource>,
): undefined | UniverseFoldResult {
	const experience = resources.find((resource) => resource.kind === EXPERIENCE_KIND);
	if (experience === undefined) {
		return undefined;
	}

	const outputs = readExperienceOutputs(experience);
	if (outputs === undefined) {
		return undefined;
	}

	return {
		entry: { universeId: outputs.assetId },
		outputs: { rootPlaceId: asRobloxAssetId(outputs.startPlaceId) },
		warnings: [],
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

function readExperienceOutputs(resource: MantleResource): ExperienceOutputs | undefined {
	const raw = resource.outputs;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return undefined;
	}

	const assetId = coerceRobloxId((raw as { assetId?: unknown }).assetId);
	const startPlaceId = coerceRobloxId((raw as { startPlaceId?: unknown }).startPlaceId);
	if (assetId === undefined || startPlaceId === undefined) {
		return undefined;
	}

	return { assetId, startPlaceId };
}
