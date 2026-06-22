import type { Result } from "@bedrock-rbx/ocale";
import type { SocialLink } from "@bedrock-rbx/ocale/universes";

import { type } from "arktype";

import { asRobloxAssetId } from "../../types/ids.ts";
import type { UniverseDesiredInput } from "../flatten.ts";
import {
	copyDeclaredSocialLinks,
	type ResourceCurrentState,
	SOCIAL_LINK_FIELDS,
	UNIVERSE_MANAGED_FLAGS,
	UNIVERSE_SINGLETON_KEY,
	type UniverseDesiredState,
} from "../resources.ts";
import type { ResolvedConfig } from "../schema.ts";
import type { BuildDesiredError, KindIo, ResourceKindModule } from "./module.ts";

const OPTIONAL_BOOLEAN = "boolean | undefined";

const socialLink = type({
	title: "string",
	uri: "string",
}).onUndeclaredKey("reject");

const socialLinkOrUndefined = socialLink.or("undefined");

const entrySchema = type({
	"consoleEnabled?": OPTIONAL_BOOLEAN,
	"desktopEnabled?": OPTIONAL_BOOLEAN,
	"discordSocialLink?": socialLinkOrUndefined,
	"displayName?": "string | undefined",
	"facebookSocialLink?": socialLinkOrUndefined,
	"guildedSocialLink?": socialLinkOrUndefined,
	"mobileEnabled?": OPTIONAL_BOOLEAN,
	"privateServerPriceRobux?": "number.integer >= 0 | undefined",
	"robloxGroupSocialLink?": socialLinkOrUndefined,
	"tabletEnabled?": OPTIONAL_BOOLEAN,
	"twitchSocialLink?": socialLinkOrUndefined,
	"twitterSocialLink?": socialLinkOrUndefined,
	"universeId": "string.digits",
	"voiceChatEnabled?": OPTIONAL_BOOLEAN,
	"vrEnabled?": OPTIONAL_BOOLEAN,
	"youtubeSocialLink?": socialLinkOrUndefined,
}).onUndeclaredKey("reject");

/**
 * Resolve the managed field names the universe driver must apply to converge
 * `current` onto `desired`. On update (a known `current`) this is exactly
 * {@link changedFieldsBetween}, so the constructed `updateMask` and the
 * root-place `displayName` patch touch only drifted fields. On create
 * (`current` omitted) every declared field is returned so a freshly adopted
 * universe is fully reconciled. Sharing this predicate with drift detection
 * keeps the patch set and the diff from diverging.
 *
 * @param desired - Desired universe state from the resolved config.
 * @param current - Last-known state, or `undefined` on create.
 * @returns Set of managed field names to apply (`universeId` aside).
 */
export function changedUniverseFields(
	desired: UniverseDesiredState,
	current?: ResourceCurrentState<"universe">,
): ReadonlySet<string> {
	return new Set(
		current === undefined
			? declaredUniverseFields(desired)
			: changedFieldsBetween(desired, current),
	);
}

function socialLinkEqual(a: SocialLink | undefined, b: SocialLink | undefined): boolean {
	if (a === undefined) {
		return b === undefined;
	}

	if (b === undefined) {
		return false;
	}

	return a.title === b.title && a.uri === b.uri;
}

function changedFieldsBetween(
	desired: UniverseDesiredState,
	current: ResourceCurrentState<"universe">,
): ReadonlyArray<string> {
	return [
		...(desired.universeId === current.universeId ? [] : ["universeId"]),
		...UNIVERSE_MANAGED_FLAGS.filter((flag) => {
			const isDesiredEnabled = desired[flag];
			return isDesiredEnabled !== undefined && isDesiredEnabled !== current[flag];
		}),
		...(desired.displayName === undefined || desired.displayName === current.displayName
			? []
			: ["displayName"]),
		...("privateServerPriceRobux" in desired &&
		desired.privateServerPriceRobux !== current.privateServerPriceRobux
			? ["privateServerPriceRobux"]
			: []),
		...SOCIAL_LINK_FIELDS.filter(
			(field) => field in desired && !socialLinkEqual(desired[field], current[field]),
		),
	];
}

function declaredUniverseFields(desired: UniverseDesiredState): ReadonlyArray<string> {
	return [
		...UNIVERSE_MANAGED_FLAGS.filter((flag) => desired[flag] !== undefined),
		...(desired.displayName === undefined ? [] : ["displayName"]),
		...("privateServerPriceRobux" in desired ? ["privateServerPriceRobux"] : []),
		...SOCIAL_LINK_FIELDS.filter((field) => field in desired),
	];
}

function flatten(config: ResolvedConfig): ReadonlyArray<UniverseDesiredInput> {
	const entry = config.universe;
	if (entry === undefined) {
		return [];
	}

	const base: UniverseDesiredInput = {
		key: UNIVERSE_SINGLETON_KEY,
		consoleEnabled: entry.consoleEnabled,
		desktopEnabled: entry.desktopEnabled,
		displayName: entry.displayName,
		kind: "universe",
		mobileEnabled: entry.mobileEnabled,
		tabletEnabled: entry.tabletEnabled,
		universeId: asRobloxAssetId(entry.universeId),
		voiceChatEnabled: entry.voiceChatEnabled,
		vrEnabled: entry.vrEnabled,
		...copyDeclaredSocialLinks(entry),
	};

	return [
		"privateServerPriceRobux" in entry
			? { ...base, privateServerPriceRobux: entry.privateServerPriceRobux }
			: base,
	];
}

function buildBaseDesired(input: UniverseDesiredInput): UniverseDesiredState {
	const base: UniverseDesiredState = {
		key: input.key,
		consoleEnabled: input.consoleEnabled,
		desktopEnabled: input.desktopEnabled,
		displayName: input.displayName,
		kind: "universe",
		mobileEnabled: input.mobileEnabled,
		tabletEnabled: input.tabletEnabled,
		universeId: input.universeId,
		voiceChatEnabled: input.voiceChatEnabled,
		vrEnabled: input.vrEnabled,
		...copyDeclaredSocialLinks(input),
	};

	return "privateServerPriceRobux" in input
		? { ...base, privateServerPriceRobux: input.privateServerPriceRobux }
		: base;
}

async function normalize(
	input: UniverseDesiredInput,
	_io: KindIo,
): Promise<Result<UniverseDesiredState, BuildDesiredError>> {
	return { data: buildBaseDesired(input), success: true };
}

function fieldsEqual(
	desired: UniverseDesiredState,
	current: ResourceCurrentState<"universe">,
): boolean {
	return changedFieldsBetween(desired, current).length === 0;
}

/**
 * Resource-kind module for the singleton Roblox universe. Owns the entry
 * schema, flattening, pass-through normalize (no file I/O), and
 * drift-equality for the `universe` kind.
 */
export const universeKind: ResourceKindModule<"universe"> = {
	changedFieldsBetween,
	entrySchema,
	fieldsEqual,
	flatten,
	kind: "universe",
	normalize,
};
