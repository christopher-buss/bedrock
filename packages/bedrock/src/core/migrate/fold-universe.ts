import { asRobloxAssetId } from "../../types/ids.ts";
import type { UniverseOutputs } from "../resources.ts";
import type { ResolvedUniverseEntry } from "../schema.ts";
import { foldBlockedExperienceFields } from "./fold-blocked-experience-fields.ts";
import { foldDisplayName } from "./fold-display-name.ts";
import { foldExperienceIcon } from "./fold-experience-icon.ts";
import { foldSocialLinks } from "./fold-social-links.ts";
import {
	blockedWarning,
	EMPTY_FRAGMENT,
	type FoldFragment,
	interpretiveWarning,
	isObjectPayload,
	mergeFragment,
} from "./fold-universe-shared.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

const EXPERIENCE_KIND = "experience";
const EXPERIENCE_ACTIVATION_KIND = "experienceActivation";
const EXPERIENCE_CONFIGURATION_KIND = "experienceConfiguration";
const SPATIAL_VOICE_KIND = "spatialVoice";

const PLAYABLE_DEVICE_TO_FLAG: Readonly<
	Record<string, "consoleEnabled" | "desktopEnabled" | "mobileEnabled" | "tabletEnabled">
> = {
	Computer: "desktopEnabled",
	Console: "consoleEnabled",
	Phone: "mobileEnabled",
	Tablet: "tabletEnabled",
};

/**
 * Output of folding the experience-related Mantle resources of one
 * environment into Bedrock's `universe` shape.
 *
 * `entry` populates the bedrock `Config.universe` block. `outputs`
 * populates the matching `BedrockState` resource's `outputs` field.
 * `warnings` carries per-rule diagnostics that the migration report
 * presents to the user.
 */
interface UniverseFoldResult {
	/**
	 * Bedrock universe entry populated from the experience resource. Carries
	 * `universeId` because the Mantle state always knows which universe the
	 * environment targets; downstream consumers rely on the post-merge
	 * invariant that `universeId` is present.
	 */
	readonly entry: ResolvedUniverseEntry;
	/** Roblox-assigned identifiers carried into `BedrockState.resources[*].outputs`. */
	readonly outputs: UniverseOutputs;
	/** Per-rule diagnostics emitted while folding this environment's resources. */
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

	const fragments = collectUniverseFragments(resources);

	const entry: ResolvedUniverseEntry = fragments.reduce<ResolvedUniverseEntry>(
		(accumulator, fragment) => ({ ...accumulator, ...fragment.entryFragment }),
		{ universeId: outputs.assetId },
	);

	const universeOutputs: UniverseOutputs = fragments.reduce<UniverseOutputs>(
		(accumulator, fragment) => ({ ...accumulator, ...fragment.outputsFragment }),
		{ rootPlaceId: asRobloxAssetId(outputs.startPlaceId) },
	);

	const warnings = fragments.flatMap((fragment) => fragment.warnings);

	return {
		entry,
		outputs: universeOutputs,
		warnings,
	};
}

function collectUniverseFragments(
	resources: ReadonlyArray<MantleResource>,
): ReadonlyArray<FoldFragment> {
	return [
		foldPlayableDevices(resources),
		foldPrivateServers(resources),
		foldVoiceChat(resources),
		foldExperienceActivation(resources),
		foldSocialLinks(resources),
		foldDisplayName(resources),
		foldExperienceIcon(resources),
		foldBlockedExperienceFields(resources),
	];
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
	if (!isObjectPayload(raw)) {
		return undefined;
	}

	const assetId = coerceRobloxId(raw["assetId"]);
	const startPlaceId = coerceRobloxId(raw["startPlaceId"]);
	if (assetId === undefined || startPlaceId === undefined) {
		return undefined;
	}

	return { assetId, startPlaceId };
}

const PLAYABLE_DEVICES_PATH = "experienceConfiguration_singleton.playableDevices";

function mapPlayableDevice(raw: unknown): FoldFragment {
	const flag = typeof raw === "string" ? PLAYABLE_DEVICE_TO_FLAG[raw] : undefined;
	if (flag === undefined) {
		return {
			entryFragment: {},
			warnings: [
				blockedWarning(
					PLAYABLE_DEVICES_PATH,
					`Unknown playableDevices value: ${String(raw)}`,
				),
			],
		};
	}

	return {
		entryFragment: { [flag]: true },
		warnings: [
			interpretiveWarning({
				bedrockPath: `universe.${flag}`,
				mantlePath: PLAYABLE_DEVICES_PATH,
				rule: "list-to-flag",
			}),
		],
	};
}

function foldPlayableDevices(resources: ReadonlyArray<MantleResource>): FoldFragment {
	const config = resources.find((resource) => resource.kind === EXPERIENCE_CONFIGURATION_KIND);
	if (config === undefined || !isObjectPayload(config.inputs)) {
		return EMPTY_FRAGMENT;
	}

	const { playableDevices } = config.inputs;
	if (!Array.isArray(playableDevices)) {
		return EMPTY_FRAGMENT;
	}

	return playableDevices.reduce<FoldFragment>(
		(accumulator, raw) => mergeFragment(accumulator, mapPlayableDevice(raw)),
		EMPTY_FRAGMENT,
	);
}

const PRIVATE_SERVERS_DISABLED: FoldFragment = {
	entryFragment: {},
	warnings: [
		interpretiveWarning({
			bedrockPath: "universe.privateServerPriceRobux",
			mantlePath: "experienceConfiguration_singleton.allowPrivateServers",
			rule: "private-servers-disabled-omitted",
		}),
	],
};

function pricedPrivateServersFragment(price: number): FoldFragment {
	return {
		entryFragment: { privateServerPriceRobux: price },
		warnings: [
			interpretiveWarning({
				bedrockPath: "universe.privateServerPriceRobux",
				mantlePath: "experienceConfiguration_singleton.privateServerPrice",
				rule: "private-servers-priced",
			}),
		],
	};
}

const EXPERIENCE_ACTIVATION_BLOCKED: FoldFragment = {
	entryFragment: {},
	warnings: [
		blockedWarning(
			"experienceActivation_singleton.isActive",
			"isActive has no Open Cloud equivalent",
		),
	],
};

function readIsActive(resources: ReadonlyArray<MantleResource>): boolean | undefined {
	const activation = resources.find((resource) => resource.kind === EXPERIENCE_ACTIVATION_KIND);
	if (activation === undefined || !isObjectPayload(activation.inputs)) {
		return undefined;
	}

	const { isActive } = activation.inputs;
	return typeof isActive === "boolean" ? isActive : undefined;
}

function foldExperienceActivation(resources: ReadonlyArray<MantleResource>): FoldFragment {
	if (readIsActive(resources) === undefined) {
		return EMPTY_FRAGMENT;
	}

	return EXPERIENCE_ACTIVATION_BLOCKED;
}

function foldVoiceChat(resources: ReadonlyArray<MantleResource>): FoldFragment {
	const voice = resources.find((resource) => resource.kind === SPATIAL_VOICE_KIND);
	if (voice === undefined || !isObjectPayload(voice.inputs)) {
		return EMPTY_FRAGMENT;
	}

	const { enabled } = voice.inputs;
	if (typeof enabled !== "boolean") {
		return EMPTY_FRAGMENT;
	}

	return {
		entryFragment: { voiceChatEnabled: enabled },
		warnings: [
			interpretiveWarning({
				bedrockPath: "universe.voiceChatEnabled",
				mantlePath: "spatialVoice_singleton.enabled",
				rule: "voice-chat-enabled",
			}),
		],
	};
}

function foldPrivateServers(resources: ReadonlyArray<MantleResource>): FoldFragment {
	const config = resources.find((resource) => resource.kind === EXPERIENCE_CONFIGURATION_KIND);
	if (config === undefined || !isObjectPayload(config.inputs)) {
		return EMPTY_FRAGMENT;
	}

	const { allowPrivateServers, privateServerPrice } = config.inputs;
	if (allowPrivateServers === false) {
		return PRIVATE_SERVERS_DISABLED;
	}

	if (allowPrivateServers !== true || typeof privateServerPrice !== "number") {
		return EMPTY_FRAGMENT;
	}

	return pricedPrivateServersFragment(privateServerPrice);
}
