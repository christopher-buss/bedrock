import type { Result } from "@bedrock/ocale";
import type { SocialLink } from "@bedrock/ocale/universes";

import { ArkErrors, type, type Type } from "arktype";
import type { SetRequired } from "type-fest";

import { RESOURCE_KEY_PATTERN_SOURCE } from "../types/ids.ts";
import type { ConfigError } from "./config-error.ts";
import { ENV_NAME_PATTERN_SOURCE } from "./environment.ts";

/**
 * Body of a single entry in the `passes` collection. Keys in the parent
 * record are `ResourceKey`-shaped strings enforced at schema validation.
 */
export interface GamePassEntry {
	/** Name shown on the Roblox storefront. */
	name: string;
	/** Description shown on the game-pass detail page. */
	description: string;
	/** Path to the icon file; handed to `readFile` verbatim by `buildDesired`. */
	iconFilePath: string;
	/** Robux price, or omitted / `undefined` for off-sale. */
	price?: number | undefined;
}

/**
 * Body of a single entry in the `places` collection. Keys in the parent
 * record are `ResourceKey`-shaped strings enforced at schema validation.
 *
 * `placeId` is user-supplied because Open Cloud cannot mint places; the
 * place must already exist in Roblox before Bedrock can publish versions
 * to it.
 */
export interface PlaceEntry {
	/** Path to the `.rbxl` or `.rbxlx` file; handed to `readFile` verbatim by `buildDesired`. */
	filePath: string;
	/** Existing Roblox place ID. */
	placeId: string;
}

/**
 * Allowed visibility values in user config. Matches ocale's
 * `UniverseVisibility` union; the universe driver translates these to
 * the Roblox wire enum before sending the PATCH.
 */
export type UniverseVisibility = "private" | "public" | "unspecified";

/**
 * Body of the singleton `universe` block. Bedrock synthesizes the
 * `ResourceKey` (`"main"`) in `flattenConfig`, so user config supplies
 * only the existing `universeId` plus any managed fields they want
 * bedrock to own. Fields omitted here remain unmanaged (the diff treats
 * them as non-drift and the driver omits them from the `updateMask`).
 *
 * `universeId` is user-supplied because Open Cloud cannot mint universes;
 * the universe must already exist in Roblox before bedrock can reconcile
 * its configuration.
 */
export interface UniverseEntry {
	/** Whether console players can join; omit or set `undefined` to leave unmanaged. */
	consoleEnabled?: boolean | undefined;
	/** Whether desktop players can join; omit or set `undefined` to leave unmanaged. */
	desktopEnabled?: boolean | undefined;
	/**
	 * Discord social link; omit to leave the server value untouched, set to
	 * `undefined` to clear it, or set to a `SocialLink` to update it.
	 */
	discordSocialLink?: SocialLink | undefined;
	/**
	 * Display name for the universe. Because Roblox derives this from
	 * the root place's name, the driver routes the update through
	 * `PlacesClient.update`; omit or set `undefined` to leave unmanaged.
	 */
	displayName?: string | undefined;
	/**
	 * Facebook social link; omit to leave the server value untouched, set to
	 * `undefined` to clear it, or set to a `SocialLink` to update it.
	 */
	facebookSocialLink?: SocialLink | undefined;
	/**
	 * Guilded social link; omit to leave the server value untouched, set to
	 * `undefined` to clear it, or set to a `SocialLink` to update it.
	 */
	guildedSocialLink?: SocialLink | undefined;
	/** Whether mobile players can join; omit or set `undefined` to leave unmanaged. */
	mobileEnabled?: boolean | undefined;
	/**
	 * Private-server price in Robux. Declare as `undefined` to disable
	 * private servers (cancels active subscriptions); omit to leave the
	 * server value untouched.
	 */
	privateServerPriceRobux?: number | undefined;
	/**
	 * Roblox Group social link; omit to leave the server value untouched, set
	 * to `undefined` to clear it, or set to a `SocialLink` to update it.
	 */
	robloxGroupSocialLink?: SocialLink | undefined;
	/** Whether tablet players can join; omit or set `undefined` to leave unmanaged. */
	tabletEnabled?: boolean | undefined;
	/**
	 * Twitch social link; omit to leave the server value untouched, set to
	 * `undefined` to clear it, or set to a `SocialLink` to update it.
	 */
	twitchSocialLink?: SocialLink | undefined;
	/**
	 * Twitter social link; omit to leave the server value untouched, set to
	 * `undefined` to clear it, or set to a `SocialLink` to update it.
	 */
	twitterSocialLink?: SocialLink | undefined;
	/** Existing Roblox universe ID. */
	universeId: string;
	/**
	 * Universe visibility. Declaring `"private"` immediately removes
	 * active players from running servers; omit or set `undefined` to
	 * leave unmanaged.
	 */
	visibility?: undefined | UniverseVisibility;
	/** Whether voice chat is enabled; omit or set `undefined` to leave unmanaged. */
	voiceChatEnabled?: boolean | undefined;
	/** Whether VR players can join; omit or set `undefined` to leave unmanaged. */
	vrEnabled?: boolean | undefined;
	/**
	 * YouTube social link; omit to leave the server value untouched, set to
	 * `undefined` to clear it, or set to a `SocialLink` to update it.
	 */
	youtubeSocialLink?: SocialLink | undefined;
}

/**
 * State configuration for the GitHub Gist backend. Holds the public gist
 * ID; the GitHub token is read from `GITHUB_TOKEN` only when the library
 * default-constructs the adapter.
 */
export interface GistStateConfig {
	/** Discriminator selecting the gist adapter. */
	readonly backend: "gist";
	/** ID of an existing GitHub Gist that holds this project's state files. */
	readonly gistId: string;
}

/**
 * Tagged union describing where Bedrock persists its state. The `backend`
 * tag is `"gist" | (string & {})` so unknown names autocomplete the
 * builtins while permitting custom values for plugin scenarios. The
 * dispatch path inside `deploy()` rejects unknown names with a typed
 * `unsupportedBackend` error.
 */
export type StateConfig = GistStateConfig | { readonly backend: string & {} };

/**
 * Body of a single entry under `environments`. Per-environment overrides
 * narrow root-level settings for that environment without redefining
 * unrelated fields. Resource overlays (`passes`, `places`, `universe`)
 * derive their field shapes from the matching root entry types so adding
 * a field to a base entry surfaces on the overlay automatically.
 *
 * `placeId` and `universeId` stay required when the matching overlay is
 * present because each environment targets its own Roblox object: an
 * overlay that mentions a place or universe must re-assert which Roblox
 * resource it points at.
 */
export interface EnvironmentEntry {
	/**
	 * Per-environment game-pass overlay. Every field is optional; missing
	 * fields fall through to the matching root `passes` entry at merge time.
	 *
	 * Uses `Partial<GamePassEntry>` directly rather than `Overlay<T, K>`
	 * because game passes have no user-supplied identity key (Open Cloud
	 * mints the asset ID). The other overlay fields use `Overlay<T, K>`
	 * to keep their identity-bearing key required.
	 */
	passes?: Record<string, Partial<GamePassEntry>>;
	/**
	 * Per-environment places overlay. `placeId` is required on every
	 * declared entry; other fields fall through to the matching root
	 * `places` entry when omitted.
	 */
	places?: Record<string, Overlay<PlaceEntry, "placeId">>;
	/** Per-environment state override; takes precedence over root `state`. */
	state?: StateConfig;
	/**
	 * Per-environment universe overlay. `universeId` is required when the
	 * overlay is present; other fields fall through to the root `universe`
	 * block when omitted.
	 */
	universe?: Overlay<UniverseEntry, "universeId">;
}

/**
 * Per-kind entry registry. Each `ResourceKind` must have a matching entry
 * type or `ResourceEntryByKind[K]` is a compile error. Modelled as an
 * interface (not a type alias) so downstream resource kinds can declare
 * their entry type alongside the kind's other domain types without
 * touching this module.
 *
 * @example
 *
 * ```ts
 * import type { ResourceEntryByKind } from "@bedrock/core";
 *
 * const entry: ResourceEntryByKind["gamePass"] = {
 *     description: "Grants VIP perks.",
 *     iconFilePath: "assets/vip-icon.png",
 *     name: "VIP Pass",
 *     price: 500,
 * };
 *
 * expect(entry.name).toBe("VIP Pass");
 * ```
 */
export interface ResourceEntryByKind {
	/** Authored entry body for a game-pass resource. */
	gamePass: GamePassEntry;
	/** Authored entry body for a place resource. */
	place: PlaceEntry;
	/** Authored entry body for a universe resource. */
	universe: UniverseEntry;
}

/**
 * Validated project config as accepted by `loadConfig`. Plain mutable so
 * users can adjust fields in a long-running script before deploying.
 *
 * Shape matches the runtime schema declared below. `rootSchema` is typed
 * against this interface via `Type<Config>`, so any drift between the two
 * is a compile error at build time. State must be configured at the
 * root or under every entry of `environments`; `resolveStateConfig`
 * surfaces the missing case at the deploy boundary as
 * `stateNotConfigured`.
 *
 * @example
 *
 * ```ts
 * import type { Config } from "@bedrock/core";
 *
 * const config: Config = {
 *     environments: { production: {} },
 *     state: { backend: "gist", gistId: "abc123def456" },
 *     passes: {
 *         "vip-pass": {
 *             description: "Grants VIP perks.",
 *             iconFilePath: "assets/vip-icon.png",
 *             name: "VIP Pass",
 *             price: 500,
 *         },
 *     },
 * };
 *
 * expect(config.passes!["vip-pass"]!.name).toBe("VIP Pass");
 * ```
 */
export interface Config {
	/**
	 * Per-environment overrides keyed by environment name. Required and
	 * non-empty: every project declares at least one environment, and
	 * `deploy()` rejects any environment name that is not a key of this
	 * record. Environment names match `[A-Za-z0-9_-]{1,64}`.
	 */
	environments: Record<string, EnvironmentEntry>;
	/** Reserved at the root for c12's config layering / overlay work. */
	extends?: unknown;
	/** Keyed-map collection of game-pass entries by user-supplied ResourceKey. */
	passes?: Record<string, GamePassEntry>;
	/** Keyed-map collection of place entries by user-supplied ResourceKey. */
	places?: Record<string, PlaceEntry>;
	/** Where Bedrock persists state for this project; required at deploy time. */
	state?: StateConfig;
	/** Singleton universe block declaring the Roblox universe bedrock manages. */
	universe?: UniverseEntry;
}

/**
 * Overlay shape used by per-environment entries: every field of `T`
 * becomes optional, except `RequiredKey`, which stays required so the
 * overlay still re-asserts the identity-bearing field of its target
 * resource.
 *
 * @template T - Base entry type whose field shapes the overlay derives from.
 * @template RequiredKey - Identity-bearing key on `T` that the overlay must
 * still declare (for example `"placeId"` or `"universeId"`).
 */
type Overlay<T, RequiredKey extends keyof T> = SetRequired<Partial<T>, RequiredKey>;

/**
 * Narrow a `StateConfig` to the `GistStateConfig` arm. The `(string & {})`
 * autocomplete idiom prevents TypeScript from narrowing on
 * `backend === "gist"` alone, so dispatch sites use this guard to
 * preserve the `gistId` field shape.
 *
 * @example
 *
 * ```ts
 * import { isGistStateConfig, type StateConfig } from "@bedrock/core";
 *
 * const config: StateConfig = { backend: "gist", gistId: "abc" };
 *
 * expect(isGistStateConfig(config)).toBeTrue();
 * if (isGistStateConfig(config)) {
 *     expect(config.gistId).toBe("abc");
 * }
 * ```
 *
 * @param config - Resolved state config to inspect.
 * @returns `true` when `config.backend === "gist"`; otherwise `false`.
 */
export function isGistStateConfig(config: StateConfig): config is GistStateConfig {
	return config.backend === "gist";
}

// Resource-kind entry schemas. Adding a new kind is two additions:
// 1. Declare its entry schema and keyed-map collection below.
// 2. Reference that collection as an optional property on `rootSchema`.
// No existing entries change. The ResourceKey regex lives on the map key
// signature so invalid identifiers surface as schema failures pointing at
// the offending key, not as deferred errors downstream.
const gamePassEntry = type({
	"name": "string",
	"description": "string",
	"iconFilePath": "string",
	"price?": "number | undefined",
});

const passesCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: gamePassEntry,
}).onUndeclaredKey("reject");

const ROBLOX_ID_DIGITS = "string.digits";

const placeEntry = type({
	filePath: "string",
	placeId: ROBLOX_ID_DIGITS,
}).onUndeclaredKey("reject");

const placesCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: placeEntry,
}).onUndeclaredKey("reject");

const OPTIONAL_BOOLEAN = "boolean | undefined";

const socialLink = type({
	title: "string",
	uri: "string",
}).onUndeclaredKey("reject");

const socialLinkOrUndefined = socialLink.or("undefined");

const universeEntry = type({
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
	"universeId": ROBLOX_ID_DIGITS,
	"visibility?": "'private' | 'public' | 'unspecified' | undefined",
	"voiceChatEnabled?": OPTIONAL_BOOLEAN,
	"vrEnabled?": OPTIONAL_BOOLEAN,
	"youtubeSocialLink?": socialLinkOrUndefined,
}).onUndeclaredKey("reject");

const stateConfig = type({
	"backend": "string",
	"gistId?": "string > 0",
}).onUndeclaredKey("reject");

// Overlay schemas mirror the base entry schemas but with every field
// optional, except the identity-bearing key (`placeId`, `universeId`)
// which stays required. Game passes have no user-supplied identity, so
// the overlay is fully partial.
const gamePassOverlay = type({
	"description?": "string",
	"iconFilePath?": "string",
	"name?": "string",
	"price?": "number | undefined",
}).onUndeclaredKey("reject");

const passesOverlayCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: gamePassOverlay,
}).onUndeclaredKey("reject");

const placeOverlay = type({
	"filePath?": "string",
	"placeId": ROBLOX_ID_DIGITS,
}).onUndeclaredKey("reject");

const placesOverlayCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: placeOverlay,
}).onUndeclaredKey("reject");

// `Overlay<UniverseEntry, "universeId">` is structurally equal to
// `UniverseEntry` itself: the base type already has every field except
// `universeId` declared as optional. Reusing `universeEntry` here keeps
// the field set in lockstep and avoids a parallel declaration to drift.
const universeOverlay = universeEntry;

const environmentEntry: Type<EnvironmentEntry> = type({
	"passes?": passesOverlayCollection,
	"places?": placesOverlayCollection,
	"state?": stateConfig,
	"universe?": universeOverlay,
}).onUndeclaredKey("reject");

const environmentsCollection = type({
	[`[/${ENV_NAME_PATTERN_SOURCE}/]`]: environmentEntry,
})
	.onUndeclaredKey("reject")
	.narrow((value, ctx) => {
		if (Object.keys(value).length === 0) {
			return ctx.mustBe("an environments record with at least one declared environment");
		}

		return true;
	});

const rootSchema: Type<Config> = type({
	"environments": environmentsCollection,
	"extends?": "unknown",
	"passes?": passesCollection,
	"places?": placesCollection,
	"state?": stateConfig,
	"universe?": universeEntry,
}).onUndeclaredKey("reject");

/**
 * Validate a parsed config value against the runtime schema. Returns the
 * validated `Config` on success or a `validationFailed` `ConfigError` with
 * one issue per problem, each attributed to a field path. `sourceFile`
 * appears in the error so callers can point a human at the offending file.
 *
 * @param input - Parsed value from a config source (object tree from a
 * config loader, or a hand-built literal). Shape is checked, not assumed.
 * @param sourceFile - Path or identifier of the source file, used in the
 * `validationFailed` error.
 * @returns `Ok` with the validated `Config`, or `Err` with a
 * `validationFailed` error carrying each issue's field path.
 * @example
 *
 * ```ts
 * import { validateConfig } from "@bedrock/core";
 *
 * const ok = validateConfig(
 *     {
 *         environments: { production: {} },
 *         passes: {
 *             "vip-pass": {
 *                 description: "VIP perks.",
 *                 iconFilePath: "assets/vip.png",
 *                 name: "VIP Pass",
 *                 price: 500,
 *             },
 *         },
 *     },
 *     "bedrock.config.ts",
 * );
 * expect(ok.success).toBeTrue();
 *
 * const err = validateConfig(
 *     { environments: { production: {} }, passes: { "vip-pass": { name: "VIP" } } },
 *     "bedrock.config.ts",
 * );
 * expect(err.success).toBeFalse();
 * if (!err.success) {
 *     expect(err.err.kind).toBe("validationFailed");
 * }
 * ```
 */
export function validateConfig(input: unknown, sourceFile: string): Result<Config, ConfigError> {
	const validated = rootSchema(input);
	if (validated instanceof ArkErrors) {
		const issues = Array.from(validated, (issue) => {
			return {
				message: issue.message,
				path: [...issue.path].map((segment) => String(segment)),
			};
		});

		return {
			err: { issues, kind: "validationFailed", sourceFile },
			success: false,
		};
	}

	return { data: validated, success: true };
}
