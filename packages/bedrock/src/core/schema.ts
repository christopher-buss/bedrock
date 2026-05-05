import type { Result } from "@bedrock/ocale";
import type { SocialLink } from "@bedrock/ocale/universes";

import { ArkErrors, type, type Type } from "arktype";
import type { SetRequired } from "type-fest";

import { RESOURCE_KEY_PATTERN_SOURCE } from "../types/ids.ts";
import type { ConfigError } from "./config-error.ts";
import { ENV_NAME_PATTERN_SOURCE } from "./environment.ts";
import { iconMap } from "./icons.ts";
import { collectUniverseIdIssues } from "./validate-universe-xor.ts";

/**
 * Body of a single entry in the `passes` collection. Keys in the parent
 * record are `ResourceKey`-shaped strings enforced at schema validation.
 */
export interface GamePassEntry {
	/** Name shown on the Roblox storefront. */
	name: string;
	/** Description shown on the game-pass detail page. */
	description: string;
	/**
	 * Locale-keyed icon paths. The map shape mirrors `UniverseEntry.icon`
	 * so authors see a single vocabulary across icon-bearing kinds; v1
	 * only accepts the `"en-us"` key. The Roblox game-pass API is
	 * monolingual, so the `"en-us"` icon is the only one ever uploaded.
	 */
	icon: Record<"en-us", string>;
	/** Robux price, or omitted / `undefined` for off-sale. */
	price?: number | undefined;
}

/**
 * Body of a single entry in the `products` collection. Keys in the parent
 * record are `ResourceKey`-shaped strings enforced at schema validation.
 */
export interface DeveloperProductEntry {
	/** Name shown on the Roblox storefront. */
	name: string;
	/** Description shown on the developer-product detail page. */
	description: string;
	/**
	 * Locale-keyed icon paths. Mirrors `GamePassEntry.icon` and
	 * `UniverseEntry.icon`; the Roblox developer-product API is monolingual,
	 * so the `"en-us"` icon is the only one ever uploaded.
	 */
	icon?: Record<"en-us", string>;
	/**
	 * Whether Roblox-managed regional pricing applies to the product.
	 * Tri-state: omit (or set `undefined`) to leave the flag unmanaged;
	 * setting `true` or `false` is propagated to Roblox on every deploy.
	 */
	isRegionalPricingEnabled?: boolean | undefined;
	/**
	 * Robux price. Omit (or set `undefined`) for an off-sale product;
	 * re-adding the field puts the product back on sale on the next deploy.
	 */
	price?: number | undefined;
	/**
	 * Whether the product appears on the universe's external store page.
	 * Tri-state: omit (or set `undefined`) to leave the flag unmanaged.
	 * The Roblox v2 create endpoint does not accept this field, so the
	 * driver applies it via a follow-up PATCH after the create POST.
	 */
	storePageEnabled?: boolean | undefined;
}

/**
 * Body of a single entry under the root `places` collection. Carries the
 * file-path environments share plus the optional Open-Cloud-supported
 * metadata fields. The Roblox `placeId` is environment-specific and lives
 * on each per-environment overlay so the same `.rbxl` file can publish to
 * different places across staging, production, and so on.
 */
export interface PlaceEntry {
	/** User-facing description shown on the place's detail page. */
	description?: string | undefined;
	/** User-facing place name shown on the Roblox storefront. */
	displayName?: string | undefined;
	/** Path to the `.rbxl` or `.rbxlx` file; handed to `readFile` verbatim by `buildDesired`. */
	filePath: string;
	/** Maximum players per server; positive integer. */
	serverSize?: number | undefined;
}

/**
 * Body of a places entry after `selectEnvironment` has merged the
 * matching per-environment overlay onto the root entry. `filePath` flows
 * from the root (or an overlay override), `placeId` is supplied by the
 * per-environment overlay, and the optional metadata fields fall through
 * from the root unless overridden per-environment.
 *
 * `placeId` is user-supplied because Open Cloud cannot mint places; the
 * place must already exist in Roblox before Bedrock can publish versions
 * to it.
 */
export interface ResolvedPlaceEntry {
	/** User-facing description shown on the place's detail page. */
	description?: string | undefined;
	/** User-facing place name shown on the Roblox storefront. */
	displayName?: string | undefined;
	/** Path to the `.rbxl` or `.rbxlx` file; handed to `readFile` verbatim by `buildDesired`. */
	filePath: string;
	/** Existing Roblox place ID. */
	placeId: string;
	/** Maximum players per server; positive integer. */
	serverSize?: number | undefined;
}

/**
 * Body of the singleton `universe` block. Bedrock synthesizes the
 * `ResourceKey` (`"main"`) in `flattenConfig`, so user config supplies
 * only the existing `universeId` plus any managed fields they want
 * bedrock to own. Fields omitted here remain unmanaged (the diff treats
 * them as non-drift and the driver omits them from the `updateMask`).
 *
 * `universeId` is user-supplied because Open Cloud cannot mint universes;
 * the universe must already exist in Roblox before bedrock can reconcile
 * its configuration. Declare `universeId` either here at the root (which
 * applies to every environment) or under each `environments[name].universe`
 * overlay, but never both: the schema rejects a config that sets it in
 * both places, and rejects a `universe` block without a resolvable
 * `universeId`.
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
	/**
	 * Locale-keyed experience-icon paths. The map shape teaches that icons
	 * are per-locale; v1 only accepts the `"en-us"` key. Omit to leave the
	 * server icon unmanaged; remove a previously declared locale to delete
	 * its icon on the next deploy.
	 */
	icon?: Record<"en-us", string>;
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
	/**
	 * Existing Roblox universe ID. Optional in this entry shape because
	 * authors may declare it here (root-authoritative, single universe) or
	 * on each `environments[name].universe` overlay (per-environment
	 * universes), but never both.
	 */
	universeId?: string | undefined;
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
 * `placeId` stays required when the matching `places` overlay is present
 * because each environment targets its own Roblox place. `universeId` is
 * optional on the `universe` overlay because authors may declare it
 * either at the root (root-authoritative) or per environment, but never
 * both: the schema enforces this XOR at validation time, attributing the
 * failure to the offending field's path.
 */
export interface EnvironmentEntry {
	/**
	 * Human-readable label fed to the project-level
	 * {@link DisplayNamePrefixConfig.format | displayNamePrefix.format}
	 * template. An environment without a label (or with an empty string)
	 * is implicitly excluded from prefixing even when the project enables
	 * it.
	 */
	label?: string | undefined;
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
	 * declared entry; `filePath` is optional and falls through to the
	 * matching root `places` entry when omitted.
	 */
	places?: Record<string, Overlay<ResolvedPlaceEntry, "placeId">>;
	/**
	 * Per-environment developer-product overlay. Every field is optional;
	 * missing fields fall through to the matching root `products` entry at
	 * merge time. Mirrors the `passes` shape because developer products
	 * also have no user-supplied identity key (Open Cloud mints the
	 * `productId`).
	 */
	products?: Record<string, Partial<DeveloperProductEntry>>;
	/** Per-environment state override; takes precedence over root `state`. */
	state?: StateConfig;
	/**
	 * Per-environment universe overlay. Every field is optional, including
	 * `universeId`: the schema-level XOR rule requires `universeId` here if
	 * and only if the root `universe` block does not declare one. Other
	 * fields fall through to the root `universe` block when omitted.
	 */
	universe?: Partial<UniverseEntry>;
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
 * import type { ResourceEntryByKind } from "@bedrock/core/config";
 *
 * const entry: ResourceEntryByKind["gamePass"] = {
 *     description: "Grants VIP perks.",
 *     icon: { "en-us": "assets/vip-icon.png" },
 *     name: "VIP Pass",
 *     price: 500,
 * };
 *
 * expect(entry.name).toBe("VIP Pass");
 * ```
 */
export interface ResourceEntryByKind {
	/** Authored entry body for a developer-product resource. */
	developerProduct: DeveloperProductEntry;
	/** Authored entry body for a game-pass resource. */
	gamePass: GamePassEntry;
	/** Post-merge entry body for a place resource (root + env overlay). */
	place: ResolvedPlaceEntry;
	/** Authored entry body for a universe resource. */
	universe: UniverseEntry;
}

/**
 * Project-level prefixing policy for universe and place display names.
 * Each environment's `label` flows through `format` to render a prefix
 * that `selectEnvironment` prepends to every declared display name.
 *
 * Defaults: `enabled` is `true`; `format` is `"[{LABEL}] "`.
 */
export interface DisplayNamePrefixConfig {
	/**
	 * Whether the project applies environment-label prefixing. Treat
	 * `undefined` as enabled; set `false` to opt out across the project.
	 */
	enabled?: boolean | undefined;
	/**
	 * Template string applied to each environment's `label`. Placeholders:
	 *
	 * - `{label}`: label as written.
	 * - `{LABEL}`: upper-cased label.
	 * - `{Label}`: capitalized label (first character upper, rest as
	 *   written).
	 *
	 * Any other characters in the template flow through verbatim. The
	 * rendered string is prepended to each declared `displayName`.
	 */
	format?: string | undefined;
}

/**
 * Per-environment universe overlay shape that prevents `universeId` from
 * being redeclared alongside a root-authoritative `universeId`.
 * Used by {@link ConfigRootUniverseId}: when the root universe block
 * declares `universeId`, no per-env overlay may redeclare it. Setting
 * `universeId` here produces a descriptive type error pointing at this
 * field rather than the opaque `never` message.
 */
export type UniverseOverlayWithoutId = Partial<WithoutKey<UniverseEntry, "universeId">> & {
	universeId?: "universeId is already declared on the root universe block; remove it from this environment overlay, or remove it from root and declare it on every environment overlay instead" & {
		readonly errorBrand: never;
	};
};

/**
 * Per-environment universe overlay shape that requires `universeId`.
 * Used by {@link ConfigEnvironmentUniverseId}: when the root universe
 * block does not declare `universeId`, every env that declares a
 * `universe` overlay must supply one of its own.
 */
export type UniverseOverlayWithId = Partial<WithoutKey<UniverseEntry, "universeId">> & {
	universeId: string;
};

/**
 * Variant of `Config` where the root `universe` block declares
 * `universeId`. Per-environment universe overlays may carry shared
 * fields (device flags, social links, display name, icon) but cannot
 * redeclare `universeId`; the schema rejects any env overlay that
 * does. The runtime `selectEnvironment` merges shared-field overlays
 * onto the root and inherits `universeId` from the root unchanged.
 */
export type ConfigRootUniverseId = ConfigBase & {
	/**
	 * Per-environment overrides keyed by environment name. Required and
	 * non-empty; environment names match `[A-Za-z0-9_-]{1,64}`. Each env
	 * entry's `universe` overlay forbids `universeId` because the root
	 * declares it.
	 */
	environments: Record<
		string,
		WithoutKey<EnvironmentEntry, "universe"> & { universe?: UniverseOverlayWithoutId }
	>;
	/**
	 * Singleton universe block declaring the Roblox universe bedrock
	 * manages. `universeId` is required in this variant because no
	 * per-environment overlay may supply one.
	 */
	universe?: UniverseEntry & { universeId: string };
};

/**
 * Variant of `Config` where the root `universe` block omits
 * `universeId`. Every env that declares a `universe` overlay must
 * supply its own `universeId`; envs that omit the overlay deploy no
 * universe at all. The root may still carry shared fields (device
 * flags, social links, display name, icon) which `selectEnvironment`
 * merges onto each env's overlay at resolution time.
 */
export type ConfigEnvironmentUniverseId = ConfigBase & {
	/**
	 * Per-environment overrides keyed by environment name. Required and
	 * non-empty; environment names match `[A-Za-z0-9_-]{1,64}`. Every
	 * env that declares a `universe` overlay must include `universeId`
	 * because the root universe block does not provide one.
	 */
	environments: Record<
		string,
		WithoutKey<EnvironmentEntry, "universe"> & { universe?: UniverseOverlayWithId }
	>;
	/**
	 * Singleton universe block declaring the Roblox universe bedrock
	 * manages. `universeId` is not permitted here in this variant because
	 * every environment supplies its own; setting it produces a descriptive
	 * type error rather than the opaque `never` message.
	 */
	universe?: WithoutKey<UniverseEntry, "universeId"> & {
		universeId?: "universeId is already declared per environment; remove it from the root universe block, or remove it from every environment overlay and declare it here instead" & {
			readonly errorBrand: never;
		};
	};
};

/**
 * Validated project config as accepted by `loadConfig`. Plain mutable so
 * users can adjust fields in a long-running script before deploying.
 *
 * Discriminated union over the location of `universeId`: it lives at the
 * root universe block ({@link ConfigRootUniverseId}) or on every
 * environment universe overlay ({@link ConfigEnvironmentUniverseId}), but never
 * both. The TypeScript types reject the both-set case at compile time,
 * and the arktype runtime narrow rejects every offending field path at
 * `validateConfig` time. State must be configured at the root or under
 * every entry of `environments`; `resolveStateConfig` surfaces the
 * missing case at the deploy boundary as `stateNotConfigured`.
 *
 * @example
 *
 * ```ts
 * import type { Config } from "@bedrock/core/config";
 *
 * const config: Config = {
 *     environments: { production: {} },
 *     state: { backend: "gist", gistId: "abc123def456" },
 *     passes: {
 *         "vip-pass": {
 *             description: "Grants VIP perks.",
 *             icon: { "en-us": "assets/vip-icon.png" },
 *             name: "VIP Pass",
 *             price: 500,
 *         },
 *     },
 * };
 *
 * expect(config.passes!["vip-pass"]!.name).toBe("VIP Pass");
 * ```
 */
export type Config = ConfigEnvironmentUniverseId | ConfigRootUniverseId;

/**
 * Body of the singleton `universe` block after `selectEnvironment` has
 * merged a per-environment overlay onto the root. Identical to
 * {@link UniverseEntry} except `universeId` is required: the schema-level
 * XOR rule ensures every projected universe carries a resolved
 * `universeId`. Resource drivers consume this shape rather than
 * `UniverseEntry` so the post-merge invariant is visible in the type
 * system.
 */
export interface ResolvedUniverseEntry extends Pick<
	UniverseEntry,
	Exclude<keyof UniverseEntry, "universeId">
> {
	/** Existing Roblox universe ID, resolved from the root or per-environment overlay. */
	universeId: string;
}

/**
 * Project config after `selectEnvironment` has merged a single
 * environment's overlays onto the root. The shape mirrors `Config`
 * except `places` carries `ResolvedPlaceEntry` (both `filePath` and
 * `placeId`), since the resolver fails before this point if an entry is
 * missing its environment-supplied `placeId`. Downstream consumers
 * (`flattenConfig`, `buildDefaultRegistry`, the deploy pipeline) accept
 * this shape rather than `Config` so the post-merge invariant is visible
 * in the type system.
 *
 * @example
 *
 * ```ts
 * import { selectEnvironment, type ResolvedConfig } from "@bedrock/core";
 * import type { Config } from "@bedrock/core/config";
 *
 * const config: Config = {
 *     environments: {
 *         production: { places: { "start-place": { placeId: "4711" } } },
 *     },
 *     places: { "start-place": { filePath: "places/start.rbxl" } },
 *     state: { backend: "gist", gistId: "abc" },
 * };
 *
 * const result = selectEnvironment(config, "production");
 * expect(result.success).toBeTrue();
 * if (result.success) {
 *     const resolved: ResolvedConfig = result.data;
 *     expect(resolved.places?.["start-place"]?.placeId).toBe("4711");
 * }
 * ```
 */
export interface ResolvedConfig extends Pick<ConfigBase, Exclude<keyof ConfigBase, "places">> {
	/**
	 * Per-environment overrides preserved from the source `Config`.
	 * Carried for downstream context; `selectEnvironment` does not read
	 * other environments after resolving the requested one.
	 */
	environments: Record<string, EnvironmentEntry>;
	/** Keyed-map collection of resolved place entries; both `filePath` and `placeId` are present. */
	places?: Record<string, ResolvedPlaceEntry>;
	/**
	 * Singleton universe block after `selectEnvironment` has resolved the
	 * XOR between root and per-environment `universeId`. The schema narrow
	 * rejects any config that would leave `universeId` unresolved, so the
	 * post-merge invariant promotes `universeId` from optional to required.
	 */
	universe?: ResolvedUniverseEntry;
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
 * Helper that produces a shallow `Omit<T, K>` without using TypeScript's
 * built-in `Omit` (deprecated under the project's lint rules because of
 * its lossy interaction with mapped types).
 *
 * @template T - Source type to project keys away from.
 * @template Key - Key (or union of keys) on `T` to remove.
 */
type WithoutKey<T, Key extends keyof T> = Pick<T, Exclude<keyof T, Key>>;

/**
 * Fields shared by every {@link Config} variant. The discriminated
 * `Config` union narrows `universe` and `environments` to enforce the
 * `universeId` XOR rule between the root and per-environment overlays;
 * everything else lives here.
 */
interface ConfigBase {
	/**
	 * Project-level prefixing of universe and place display names with the
	 * environment label. Default behaviour (when omitted) is enabled with a
	 * `"[{LABEL}] "` template; set `enabled: false` to opt out, or set
	 * `format` to a custom template.
	 */
	displayNamePrefix?: DisplayNamePrefixConfig;
	/** Reserved at the root for c12's config layering / overlay work. */
	extends?: unknown;
	/** Keyed-map collection of game-pass entries by user-supplied ResourceKey. */
	passes?: Record<string, GamePassEntry>;
	/** Keyed-map collection of place entries by user-supplied ResourceKey. */
	places?: Record<string, PlaceEntry>;
	/** Keyed-map collection of developer-product entries by user-supplied ResourceKey. */
	products?: Record<string, DeveloperProductEntry>;
	/** Where Bedrock persists state for this project; required at deploy time. */
	state?: StateConfig;
}

/**
 * Narrow a `StateConfig` to the `GistStateConfig` arm. The `(string & {})`
 * autocomplete idiom prevents TypeScript from narrowing on
 * `backend === "gist"` alone, so dispatch sites use this guard to
 * preserve the `gistId` field shape.
 *
 * @example
 *
 * ```ts
 * import { isGistStateConfig } from "@bedrock/core";
 * import type { StateConfig } from "@bedrock/core/config";
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

const OPTIONAL_BOOLEAN = "boolean | undefined";

const OPTIONAL_STRING = "string | undefined";

/**
 * Shared arktype constraint for any optional positive-integer field.
 * Reused by per-kind entry schemas so positive-integer fields validate
 * identically.
 */
export const OPTIONAL_POSITIVE_INTEGER = "(number.integer >= 1) | undefined";

/**
 * Shared arktype constraint for any optional Robux-price field. The schema
 * rejects negatives, fractional values, `NaN`, and `Infinity` at config
 * validation time so a malformed price surfaces with a path attributing the
 * failure to the offending field, rather than slipping through to the
 * Roblox API and surfacing as an opaque error at apply time. Per-kind entry
 * schemas reuse this constant so all Robux-price fields validate
 * identically.
 */
export const OPTIONAL_ROBUX_PRICE = "number.integer >= 0 | undefined";

// Resource-kind entry schemas. Adding a new kind is two additions:
// 1. Declare its entry schema and keyed-map collection below.
// 2. Reference that collection as an optional property on `rootSchema`.
// No existing entries change. The ResourceKey regex lives on the map key
// signature so invalid identifiers surface as schema failures pointing at
// the offending key, not as deferred errors downstream.
const gamePassEntry = type({
	"name": "string",
	"description": "string",
	"icon": iconMap,
	"price?": OPTIONAL_ROBUX_PRICE,
});

const passesCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: gamePassEntry,
}).onUndeclaredKey("reject");

const developerProductEntry = type({
	"name": "string",
	"description": "string",
	"icon?": iconMap,
	"isRegionalPricingEnabled?": OPTIONAL_BOOLEAN,
	"price?": OPTIONAL_ROBUX_PRICE,
	"storePageEnabled?": OPTIONAL_BOOLEAN,
}).onUndeclaredKey("reject");

const productsCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: developerProductEntry,
}).onUndeclaredKey("reject");

const ROBLOX_ID_DIGITS = "string.digits";

const placeEntry = type({
	"description?": OPTIONAL_STRING,
	"displayName?": OPTIONAL_STRING,
	"filePath": "string",
	"serverSize?": OPTIONAL_POSITIVE_INTEGER,
}).onUndeclaredKey("reject");

const placesCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: placeEntry,
}).onUndeclaredKey("reject");

const socialLink = type({
	title: "string",
	uri: "string",
}).onUndeclaredKey("reject");

const socialLinkOrUndefined = socialLink.or("undefined");

const universeEntry = type({
	"consoleEnabled?": OPTIONAL_BOOLEAN,
	"desktopEnabled?": OPTIONAL_BOOLEAN,
	"discordSocialLink?": socialLinkOrUndefined,
	"displayName?": OPTIONAL_STRING,
	"facebookSocialLink?": socialLinkOrUndefined,
	"guildedSocialLink?": socialLinkOrUndefined,
	"icon?": iconMap,
	"mobileEnabled?": OPTIONAL_BOOLEAN,
	"privateServerPriceRobux?": OPTIONAL_ROBUX_PRICE,
	"robloxGroupSocialLink?": socialLinkOrUndefined,
	"tabletEnabled?": OPTIONAL_BOOLEAN,
	"twitchSocialLink?": socialLinkOrUndefined,
	"twitterSocialLink?": socialLinkOrUndefined,
	"universeId?": ROBLOX_ID_DIGITS,
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
	"icon?": iconMap,
	"name?": "string",
	"price?": OPTIONAL_ROBUX_PRICE,
}).onUndeclaredKey("reject");

const passesOverlayCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: gamePassOverlay,
}).onUndeclaredKey("reject");

const developerProductOverlay = type({
	"description?": "string",
	"icon?": iconMap,
	"isRegionalPricingEnabled?": OPTIONAL_BOOLEAN,
	"name?": "string",
	"price?": OPTIONAL_ROBUX_PRICE,
	"storePageEnabled?": OPTIONAL_BOOLEAN,
}).onUndeclaredKey("reject");

const productsOverlayCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: developerProductOverlay,
}).onUndeclaredKey("reject");

const placeOverlay = type({
	"description?": OPTIONAL_STRING,
	"displayName?": OPTIONAL_STRING,
	"filePath?": "string",
	"placeId": ROBLOX_ID_DIGITS,
	"serverSize?": OPTIONAL_POSITIVE_INTEGER,
}).onUndeclaredKey("reject");

const placesOverlayCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: placeOverlay,
}).onUndeclaredKey("reject");

// `Partial<UniverseEntry>` is structurally equal to `UniverseEntry`
// itself because every field on `UniverseEntry` is optional. Reusing
// `universeEntry` here keeps the field set in lockstep and avoids a
// parallel declaration to drift. The XOR rule that ties root and
// per-environment `universeId` together lives on `rootSchema` below,
// where both sides of the relationship are in scope.
const universeOverlay = universeEntry;

const environmentEntry: Type<EnvironmentEntry> = type({
	"label?": OPTIONAL_STRING,
	"passes?": passesOverlayCollection,
	"places?": placesOverlayCollection,
	"products?": productsOverlayCollection,
	"state?": stateConfig,
	"universe?": universeOverlay,
}).onUndeclaredKey("reject");

const displayNamePrefix: Type<DisplayNamePrefixConfig> = type({
	"enabled?": OPTIONAL_BOOLEAN,
	"format?": OPTIONAL_STRING,
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

// `rootSchema` is intentionally not annotated `Type<Config>` because
// `Config` is a discriminated union enforcing the universeId XOR rule
// at the type level. The arktype schema describes the loose
// authored-shape that's structurally a supertype of every union arm;
// the runtime narrow rejects any value that doesn't satisfy one arm so
// `validateConfig` can cast the result to `Config` safely. Splitting
// the schema into two `.or()` variants would mirror the type union but
// duplicate every field declaration without buying additional runtime
// coverage on top of the narrow.
const rootSchema = type({
	"displayNamePrefix?": displayNamePrefix,
	"environments": environmentsCollection,
	"extends?": "unknown",
	"passes?": passesCollection,
	"places?": placesCollection,
	"products?": productsCollection,
	"state?": stateConfig,
	"universe?": universeEntry,
})
	.onUndeclaredKey("reject")
	.narrow((value, ctx) => {
		// `ctx.reject` returns `false` for every issue and `reduce` walks the
		// whole list so every offending field gets attributed; the seeded
		// `true` flips to `false` on the first issue.
		return collectUniverseIdIssues(value).reduce<boolean>((_accumulator, issue) => {
			return ctx.reject({ message: issue.message, path: [...issue.path] });
		}, true);
	});

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
 *                 icon: { "en-us": "assets/vip.png" },
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

	// Precondition for the cast: the runtime narrow rejects every value
	// that violates the universeId XOR rule, so a successful validation
	// always lands in one arm of the discriminated `Config` union. The
	// schema's inferred type is the structurally loose authored-shape
	// (universeId optional in both root and per-env overlays); the cast
	// collapses it to the strict union without loss of safety.
	return { data: validated as unknown as Config, success: true };
}
