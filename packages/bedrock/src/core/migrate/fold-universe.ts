import { asRobloxAssetId } from "../../types/ids.ts";
import type { UniverseOutputs } from "../resources.ts";
import type { UniverseEntry } from "../schema.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

const EXPERIENCE_KIND = "experience";
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

interface FoldFragment {
	readonly entryFragment: Partial<UniverseEntry>;
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

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

function isObjectPayload(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
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

function mergeFragment(left: FoldFragment, right: FoldFragment): FoldFragment {
	return {
		entryFragment: { ...left.entryFragment, ...right.entryFragment },
		warnings: [...left.warnings, ...right.warnings],
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

const EMPTY_FRAGMENT: FoldFragment = { entryFragment: {}, warnings: [] };
