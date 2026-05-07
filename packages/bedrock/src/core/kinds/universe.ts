import type { Result } from "@bedrock/ocale";
import type { SocialLink } from "@bedrock/ocale/universes";

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

function socialLinkEqual(a: SocialLink | undefined, b: SocialLink | undefined): boolean {
	if (a === undefined) {
		return b === undefined;
	}

	if (b === undefined) {
		return false;
	}

	return a.title === b.title && a.uri === b.uri;
}

function declaredSocialLinksEqual(
	desired: UniverseDesiredState,
	current: ResourceCurrentState<"universe">,
): boolean {
	for (const field of SOCIAL_LINK_FIELDS) {
		if (!(field in desired)) {
			continue;
		}

		if (!socialLinkEqual(desired[field], current[field])) {
			return false;
		}
	}

	return true;
}

function fieldsEqual(
	desired: UniverseDesiredState,
	current: ResourceCurrentState<"universe">,
): boolean {
	if (desired.universeId !== current.universeId) {
		return false;
	}

	// Only compare flags the user has declared. An undeclared flag stays
	// owned by whoever else writes to the universe (Creator Hub, another
	// tool), so a concrete current value for it is not drift.
	for (const flag of UNIVERSE_MANAGED_FLAGS) {
		const isDesiredEnabled = desired[flag];
		if (isDesiredEnabled !== undefined && isDesiredEnabled !== current[flag]) {
			return false;
		}
	}

	if (desired.displayName !== undefined && desired.displayName !== current.displayName) {
		return false;
	}

	if (
		"privateServerPriceRobux" in desired &&
		desired.privateServerPriceRobux !== current.privateServerPriceRobux
	) {
		return false;
	}

	return declaredSocialLinksEqual(desired, current);
}

/**
 * Resource-kind module for the singleton Roblox universe. Owns the entry
 * schema, flattening, pass-through normalize (no file I/O), and
 * drift-equality for the `universe` kind.
 */
export const universeKind: ResourceKindModule<"universe"> = {
	entrySchema,
	fieldsEqual,
	flatten,
	kind: "universe",
	normalize,
};
