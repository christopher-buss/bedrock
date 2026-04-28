import { asRobloxAssetId } from "../../types/ids.ts";
import type { UniverseOutputs } from "../resources.ts";
import type { UniverseEntry } from "../schema.ts";
import { foldSocialLinks } from "./fold-social-links.ts";
import {
	EMPTY_FRAGMENT,
	type FoldFragment,
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
 * `warnings` accumulates per-rule diagnostics; the skeleton emits an
 * empty list because no interpretive rules have landed yet.
 */
interface UniverseFoldResult {
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

	const fragments: ReadonlyArray<FoldFragment> = [
		foldPlayableDevices(resources),
		foldPrivateServers(resources),
		foldVoiceChat(resources),
		foldVisibility(resources),
		foldSocialLinks(resources),
	];

	const entry: UniverseEntry = fragments.reduce<UniverseEntry>(
		(accumulator, fragment) => ({ ...accumulator, ...fragment.entryFragment }),
		{ universeId: outputs.assetId },
	);

	const warnings = fragments.flatMap((fragment) => fragment.warnings);

	return {
		entry,
		outputs: { rootPlaceId: asRobloxAssetId(outputs.startPlaceId) },
		warnings,
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
				{
					kind: "blocked",
					mantlePath: PLAYABLE_DEVICES_PATH,
					reason: `Unknown playableDevices value: ${String(raw)}`,
				},
			],
		};
	}

	return {
		entryFragment: { [flag]: true },
		warnings: [
			{
				bedrockPath: `universe.${flag}`,
				kind: "interpretive",
				mantlePath: PLAYABLE_DEVICES_PATH,
				rule: "list-to-flag",
			},
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
		{
			bedrockPath: "universe.privateServerPriceRobux",
			kind: "interpretive",
			mantlePath: "experienceConfiguration_singleton.allowPrivateServers",
			rule: "private-servers-disabled-omitted",
		},
	],
};

function pricedPrivateServersFragment(price: number): FoldFragment {
	return {
		entryFragment: { privateServerPriceRobux: price },
		warnings: [
			{
				bedrockPath: "universe.privateServerPriceRobux",
				kind: "interpretive",
				mantlePath: "experienceConfiguration_singleton.privateServerPrice",
				rule: "private-servers-priced",
			},
		],
	};
}

const VISIBILITY_PUBLIC_FRAGMENT: FoldFragment = {
	entryFragment: { visibility: "public" },
	warnings: [
		{
			bedrockPath: "universe.visibility",
			kind: "interpretive",
			mantlePath: "experienceActivation_singleton.isActive",
			rule: "active-public-combo",
		},
	],
};

const VISIBILITY_AMBIGUOUS: FoldFragment = {
	entryFragment: {},
	warnings: [
		{
			hint: "Set visibility manually or deactivate the universe in the Roblox dashboard; auto-mapping isActive=false to visibility=private would kick live players.",
			kind: "ambiguous",
			mantlePath: "experienceActivation_singleton.isActive",
		},
	],
};

const VISIBILITY_FRIENDS_BLOCKED: FoldFragment = {
	entryFragment: {},
	warnings: [
		{
			kind: "blocked",
			mantlePath: "experienceConfiguration_singleton.isFriendsOnly",
			reason: "isFriendsOnly has no Open Cloud equivalent",
		},
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

function readIsFriendsOnly(resources: ReadonlyArray<MantleResource>): boolean | undefined {
	const config = resources.find((resource) => resource.kind === EXPERIENCE_CONFIGURATION_KIND);
	if (config === undefined || !isObjectPayload(config.inputs)) {
		return undefined;
	}

	const { isFriendsOnly } = config.inputs;
	return typeof isFriendsOnly === "boolean" ? isFriendsOnly : undefined;
}

function foldVisibility(resources: ReadonlyArray<MantleResource>): FoldFragment {
	const isActive = readIsActive(resources);
	if (isActive === undefined) {
		return EMPTY_FRAGMENT;
	}

	if (!isActive) {
		return VISIBILITY_AMBIGUOUS;
	}

	const isFriendsOnly = readIsFriendsOnly(resources);
	if (isFriendsOnly === true) {
		return VISIBILITY_FRIENDS_BLOCKED;
	}

	return VISIBILITY_PUBLIC_FRAGMENT;
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
			{
				bedrockPath: "universe.voiceChatEnabled",
				kind: "interpretive",
				mantlePath: "spatialVoice_singleton.enabled",
				rule: "voice-chat-enabled",
			},
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
