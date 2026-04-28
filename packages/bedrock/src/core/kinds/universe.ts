import type { Result } from "@bedrock/ocale";
import type { SocialLink } from "@bedrock/ocale/universes";

import { type } from "arktype";

import { asRobloxAssetId, asSha256Hex, type Sha256Hex } from "../../types/ids.ts";
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
import { sha256Hex } from "./hash.ts";
import type { BuildDesiredError, KindIo, ResourceKindModule } from "./module.ts";
import { readBytes } from "./read-bytes.ts";

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
	"visibility?": "'private' | 'public' | 'unspecified' | undefined",
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
		visibility: entry.visibility,
		voiceChatEnabled: entry.voiceChatEnabled,
		vrEnabled: entry.vrEnabled,
		...copyDeclaredSocialLinks(entry),
	};

	const withPrice =
		"privateServerPriceRobux" in entry
			? { ...base, privateServerPriceRobux: entry.privateServerPriceRobux }
			: base;

	return [entry.icon === undefined ? withPrice : { ...withPrice, icon: entry.icon }];
}

async function hashIconLocales(
	input: UniverseDesiredInput & { readonly icon: Record<"en-us", string> },
	io: KindIo,
): Promise<Result<Record<"en-us", Sha256Hex>, BuildDesiredError>> {
	const read = await readBytes({ key: input.key, filePath: input.icon["en-us"] }, io);
	if (!read.success) {
		return read;
	}

	return {
		data: { "en-us": asSha256Hex(await sha256Hex(read.data)) },
		success: true,
	};
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
		visibility: input.visibility,
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
	io: KindIo,
): Promise<Result<UniverseDesiredState, BuildDesiredError>> {
	const withPrice = buildBaseDesired(input);

	if (input.icon === undefined) {
		return { data: withPrice, success: true };
	}

	const hashes = await hashIconLocales({ ...input, icon: input.icon }, io);
	if (!hashes.success) {
		return hashes;
	}

	return {
		data: { ...withPrice, icon: input.icon, iconFileHashes: hashes.data },
		success: true,
	};
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

function iconHashesEqual(
	desired: UniverseDesiredState,
	current: ResourceCurrentState<"universe">,
): boolean {
	if (desired.iconFileHashes === undefined) {
		return current.iconFileHashes === undefined;
	}

	if (current.iconFileHashes === undefined) {
		return false;
	}

	return desired.iconFileHashes["en-us"] === current.iconFileHashes["en-us"];
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

	if (desired.visibility !== undefined && desired.visibility !== current.visibility) {
		return false;
	}

	if (
		"privateServerPriceRobux" in desired &&
		desired.privateServerPriceRobux !== current.privateServerPriceRobux
	) {
		return false;
	}

	if (!iconHashesEqual(desired, current)) {
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
