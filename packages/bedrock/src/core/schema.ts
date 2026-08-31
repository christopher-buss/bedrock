/* eslint-disable max-lines -- centralized public-API schema; growing the surface here is expected. */
import type { Result } from "@bedrock-rbx/ocale";
import type { SocialLink } from "@bedrock-rbx/ocale/universes";

import { ArkErrors, type, type Type } from "arktype";
import type { SetRequired } from "type-fest";

import { RESOURCE_KEY_PATTERN_SOURCE } from "../types/ids.ts";
import type { ConfigError, ConfigValidationIssue } from "./config-error.ts";
import { ENV_NAME_PATTERN_SOURCE } from "./environment.ts";
import { iconMap } from "./icons.ts";
import { EMPTY_PLUGIN_REGISTRY, type PluginRegistry } from "./plugin-registry.ts";
import type { StateBackendSchema } from "./plugin.ts";
import { collectUniverseIdIssues } from "./validate-universe-xor.ts";

/**
 * Per-field redaction override for a game-pass entry. Each supplied field
 * replaces the matching bedrock-supplied placeholder; omitted fields fall
 * through to the placeholder defaults. The object form implies redaction
 * is enabled, so authors who want only defaults should write
 * `redacted: true` instead of an empty object.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { GamePassEntry, RedactedGamePassOverride } from "@bedrock-rbx/core/config";
 *
 * const override: RedactedGamePassOverride = { name: "Closed Beta", price: 500 };
 *
 * const entry: GamePassEntry = {
 *     name: "VIP Pass",
 *     description: "Grants VIP perks.",
 *     icon: { "en-us": "assets/vip.png" },
 *     price: 1500,
 *     redacted: override,
 * };
 *
 * expect(entry.redacted).toStrictEqual({ name: "Closed Beta", price: 500 });
 * ```
 */
export interface RedactedGamePassOverride {
	/** Override name; falls through to the bedrock default when omitted. */
	name?: string | undefined;
	/**
	 * Override description; falls through to the bedrock default when omitted.
	 */
	description?: string | undefined;
	/**
	 * Override icon path; falls through to the embedded placeholder when
	 * omitted.
	 */
	icon?: Record<"en-us", string> | undefined;
	/**
	 * Override Robux price; falls through to the bedrock default (`99999`) when
	 * omitted. Ignored when the entry's `price` is `undefined` so an off-sale
	 * pass stays off-sale through redaction.
	 */
	price?: number | undefined;
}

/**
 * Per-field redaction override for a place entry. Each supplied field
 * replaces the matching bedrock-supplied placeholder; omitted `description`
 * falls through to the placeholder default. `displayName` has no
 * placeholder default; an omitted `displayName` preserves the real value
 * declared on the entry. The object form implies redaction is enabled, so
 * authors who want only the description default should write
 * `redacted: true` instead of an empty object.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { PlaceEntry, RedactedPlaceOverride } from "@bedrock-rbx/core/config";
 *
 * const override: RedactedPlaceOverride = { displayName: "Hidden Project" };
 *
 * const entry: PlaceEntry = {
 *     description: "The lobby place.",
 *     displayName: "Start Place",
 *     filePath: "places/start.rbxl",
 *     redacted: override,
 * };
 *
 * expect(entry.redacted).toStrictEqual({ displayName: "Hidden Project" });
 * ```
 */
export interface RedactedPlaceOverride {
	/**
	 * Override description; falls through to the bedrock default when omitted.
	 */
	description?: string | undefined;
	/**
	 * Override display name; preserves the real entry value when omitted (no
	 * default).
	 */
	displayName?: string | undefined;
}

/**
 * Env-scoped redaction override that applies across every redactable kind in
 * a single environment. Each field is projected onto the kinds whose own
 * override type names it: `price`, `name`, and `icon` reach passes and
 * products; `description` reaches passes, products, and places; `displayName`
 * reaches places. Fields a kind does not recognize are silently ignored for
 * that kind.
 *
 * Composes field-by-field with per-resource overrides at the root and inside
 * an env overlay; the most-specific layer wins per field. Boolean `true`
 * contributes no fields; `false` carves the resource out at its layer.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { Config, RedactedEnvironmentOverride } from "@bedrock-rbx/core/config";
 *
 * const devRedaction: RedactedEnvironmentOverride = { price: 1 };
 *
 * const config: Config = {
 *     environments: { dev: { redacted: devRedaction } },
 *     passes: {
 *         "vip-pass": {
 *             name: "VIP Pass",
 *             description: "Grants VIP perks.",
 *             icon: { "en-us": "assets/vip.png" },
 *             price: 500,
 *         },
 *     },
 *     state: { backend: "gist", gistId: "abc123" },
 * };
 *
 * expect(config.environments["dev"]?.redacted).toStrictEqual({ price: 1 });
 * ```
 */
export interface RedactedEnvironmentOverride {
	/**
	 * Override name applied to every passes and products entry the env
	 * redacts.
	 */
	name?: string | undefined;
	/**
	 * Override description applied to every passes, products, and places entry
	 * the env redacts.
	 */
	description?: string | undefined;
	/**
	 * Override display name applied only to places (and universes, when their
	 * redaction lands).
	 */
	displayName?: string | undefined;
	/**
	 * Override icon path applied to every passes and products entry the env
	 * redacts.
	 */
	icon?: Record<"en-us", string> | undefined;
	/**
	 * Override Robux price applied to every on-sale passes and products entry
	 * the env redacts.
	 */
	price?: number | undefined;
}

/**
 * Body of a single entry in the `passes` collection. Keys in the parent
 * record are `ResourceKey`-shaped strings enforced at schema validation.
 *
 * @since 0.1.0
 */
export interface GamePassEntry {
	/** Name shown on the Roblox storefront. */
	name: string;
	/** Description shown on the game-pass detail page. */
	description: string;
	/**
	 * Locale-keyed icon path. The Roblox game-pass API is monolingual, so
	 * only the `"en-us"` key is accepted; the map shape leaves room for
	 * translated icons should the API ever expose them.
	 */
	icon: Record<"en-us", string>;
	/** Robux price, or omitted / `undefined` for off-sale. */
	price?: number | undefined;
	/**
	 * Set to `true` to deploy this pass with bedrock-supplied placeholder
	 * content (default name, empty description, embedded placeholder icon,
	 * price `99999` Robux when the entry is on-sale) in place of the real
	 * values declared above. Off-sale passes (`price` omitted) stay off-sale.
	 * Set to a {@link RedactedGamePassOverride} to substitute selected
	 * placeholders with custom values while leaving the rest at bedrock
	 * defaults; the object form implies redaction is enabled. Omit or set
	 * `false` to push the real values unchanged. Environment overlays accept
	 * the same shape and compose field-by-field with this layer.
	 */
	redacted?: boolean | RedactedGamePassOverride | undefined;
}

/**
 * Per-field redaction override for a developer-product entry. Each supplied
 * field replaces the matching bedrock-supplied placeholder; omitted fields
 * fall through to the placeholder defaults. The object form implies
 * redaction is enabled, so authors who want only defaults should write
 * `redacted: true` instead of an empty object.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type {
 *     DeveloperProductEntry,
 *     RedactedDeveloperProductOverride,
 * } from "@bedrock-rbx/core/config";
 *
 * const override: RedactedDeveloperProductOverride = {
 *     name: "Closed Beta Pack",
 *     price: 500,
 * };
 *
 * const entry: DeveloperProductEntry = {
 *     name: "Gem Pack",
 *     description: "Stocks the player up with 1,000 premium gems.",
 *     price: 1500,
 *     redacted: override,
 * };
 *
 * expect(entry.redacted).toStrictEqual({ name: "Closed Beta Pack", price: 500 });
 * ```
 */
export interface RedactedDeveloperProductOverride {
	/** Override name; falls through to the bedrock default when omitted. */
	name?: string | undefined;
	/**
	 * Override description; falls through to the bedrock default when omitted.
	 */
	description?: string | undefined;
	/**
	 * Override icon path; falls through to the embedded placeholder when
	 * omitted.
	 */
	icon?: Record<"en-us", string> | undefined;
	/**
	 * Override Robux price; falls through to the bedrock default (`99999`) when
	 * omitted. Ignored when the entry's `price` is `undefined` so an off-sale
	 * product stays off-sale through redaction.
	 */
	price?: number | undefined;
}

/**
 * Body of a single entry in the `products` collection. Keys in the parent
 * record are `ResourceKey`-shaped strings enforced at schema validation.
 *
 * @since 0.1.0
 */
export interface DeveloperProductEntry {
	/** Name shown on the Roblox storefront. */
	name: string;
	/** Description shown on the developer-product detail page. */
	description: string;
	/**
	 * Locale-keyed icon path. Mirrors `GamePassEntry.icon`; the Roblox
	 * developer-product API is monolingual, so only the `"en-us"` key is
	 * accepted.
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
	 * Set to `true` to deploy this product with bedrock-supplied placeholder
	 * content (default name, empty description, embedded placeholder icon,
	 * price `99999` Robux when the entry is on-sale) in place of the real
	 * values declared above. Off-sale products (`price` omitted) stay
	 * off-sale. Set to a {@link RedactedDeveloperProductOverride} to
	 * substitute selected placeholders with custom values while leaving the
	 * rest at bedrock defaults; the object form implies redaction is enabled.
	 * Omit or set `false` to push the real values unchanged. Environment
	 * overlays accept the same shape and compose field-by-field with this
	 * layer.
	 */
	redacted?: boolean | RedactedDeveloperProductOverride | undefined;
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
 *
 * Every field is optional: an entry that omits `filePath` declares a
 * config-only place whose metadata bedrock manages without publishing any
 * file.
 *
 * @since 0.1.0
 */
export interface PlaceEntry {
	/** User-facing description shown on the place's detail page. */
	description?: string | undefined;
	/** User-facing place name shown on the Roblox storefront. */
	displayName?: string | undefined;
	/**
	 * Path to the `.rbxl` or `.rbxlx` file; handed to `readFile` verbatim by
	 * `buildDesired`.
	 *
	 * Omit it to declare a **config-only** place: bedrock reconciles the
	 * metadata fields against the existing Roblox place and never reads or
	 * publishes a file. An environment overlay may supply a path the root
	 * entry omits, but cannot clear one the root entry declares.
	 */
	filePath?: string | undefined;
	/**
	 * Set to `true` to deploy this place with bedrock-supplied placeholder
	 * content (empty description) in place of the real values declared
	 * above. `displayName` is preserved by default because it surfaces in
	 * Roblox Studio's place picker and the Creator Hub experience list;
	 * authors who want full opacity write the object form
	 * {@link RedactedPlaceOverride} to substitute selected placeholders
	 * with custom values, including `displayName`. The object form
	 * implies redaction is enabled. Omit or set `false` to push the real
	 * values unchanged. Environment overlays accept the same shape and
	 * compose field-by-field with this layer.
	 */
	redacted?: boolean | RedactedPlaceOverride | undefined;
	/** Maximum players per server; positive integer. */
	serverSize?: number | undefined;
}

/**
 * Body of a places entry after `selectEnvironment` has merged the
 * matching per-environment overlay onto the root entry. `filePath` flows
 * from the root (or an overlay override) and stays `undefined` for a
 * config-only place, `placeId` is supplied by the per-environment overlay,
 * and the optional metadata fields fall through from the root unless
 * overridden per-environment.
 *
 * `placeId` is user-supplied because Open Cloud cannot mint places; the
 * place must already exist in Roblox before Bedrock can publish versions
 * to it.
 *
 * @since 0.1.0
 */
export interface ResolvedPlaceEntry {
	/** User-facing description shown on the place's detail page. */
	description?: string | undefined;
	/** User-facing place name shown on the Roblox storefront. */
	displayName?: string | undefined;
	/**
	 * Path to the `.rbxl` or `.rbxlx` file; handed to `readFile` verbatim by
	 * `buildDesired`. `undefined` for a config-only place; see
	 * {@link PlaceEntry.filePath}.
	 */
	filePath?: string | undefined;
	/** Existing Roblox place ID. */
	placeId: string;
	/**
	 * Resolved redaction setting after merging the per-environment overlay
	 * onto the root entry. See {@link PlaceEntry.redacted} for the
	 * authored shape.
	 */
	redacted?: boolean | RedactedPlaceOverride | undefined;
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
 *
 * @since 0.1.0
 */
export interface UniverseEntry {
	/**
	 * Whether console players can join; omit or set `undefined` to leave
	 * unmanaged.
	 */
	consoleEnabled?: boolean | undefined;
	/**
	 * Whether desktop players can join; omit or set `undefined` to leave
	 * unmanaged.
	 */
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
	 * Whether mobile players can join; omit or set `undefined` to leave
	 * unmanaged.
	 */
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
	/**
	 * Whether tablet players can join; omit or set `undefined` to leave
	 * unmanaged.
	 */
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
	/**
	 * Whether voice chat is enabled; omit or set `undefined` to leave
	 * unmanaged.
	 */
	voiceChatEnabled?: boolean | undefined;
	/**
	 * Whether VR players can join; omit or set `undefined` to leave unmanaged.
	 */
	vrEnabled?: boolean | undefined;
	/**
	 * YouTube social link; omit to leave the server value untouched, set to
	 * `undefined` to clear it, or set to a `SocialLink` to update it.
	 */
	youtubeSocialLink?: SocialLink | undefined;
}

/**
 * State configuration for the GitHub Gist backend. Holds the public gist
 * ID; the library reads the GitHub token from `BEDROCK_GITHUB_TOKEN` when
 * it default-constructs the adapter.
 *
 * @since 0.1.0
 */
export interface GistStateConfig {
	/** Discriminator selecting the gist adapter. */
	readonly backend: "gist";
	/** ID of an existing GitHub Gist that holds this project's state files. */
	readonly gistId: string;
	/**
	 * Whether a **Deploy** takes a hold on the **Environment** before
	 * applying anything. Defaults to on wherever the **Backend** offers
	 * exclusion; set it to `false` to deploy without one, which is for
	 * projects that serialize their deploys some other way. A **Backend**
	 * that offers no exclusion is unaffected by it.
	 */
	readonly locking?: boolean;
}

/**
 * `state` block naming a **Backend** core does not ship. The keys
 * alongside `backend` are whatever the plugin claiming that name declared,
 * so they are open here and validated against the plugin's own schema
 * fragment during config load.
 *
 * @since 0.2.0
 */
export interface PluginStateConfig {
	/** Name of the plugin-declared **Backend** to persist state through. */
	readonly backend: string & {};
	/**
	 * Whether a **Deploy** takes a hold on the **Environment** before
	 * applying anything. Defaults to on wherever the **Backend** offers
	 * exclusion; set it to `false` to deploy without one, which is for
	 * projects that serialize their deploys some other way. A **Backend**
	 * that offers no exclusion is unaffected by it.
	 */
	readonly locking?: boolean;
	/** Keys the plugin claiming this **Backend** declared. */
	readonly [key: string]: unknown;
}

/**
 * Tagged union describing where Bedrock persists its state. The `backend`
 * tag is `"gist" | (string & {})` so unknown names autocomplete the
 * builtins while permitting custom values for plugin scenarios. The
 * dispatch path inside `deploy()` rejects a name no loaded plugin claimed
 * with a typed `unsupportedBackend` error.
 *
 * @since 0.1.0
 */
export type StateConfig = GistStateConfig | PluginStateConfig;

/**
 * Every `state.backend` value core ships an adapter for. Widening this as
 * core gains a **Backend** is what forces the name to be claimed against
 * plugins, so a plugin cannot quietly take over a builtin.
 *
 * Internal: not re-exported from `src/index.ts`.
 */
export type BuiltinStateBackend = GistStateConfig["backend"];

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
 *
 * @since 0.1.0
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
	 * Uses a partial `GamePassEntry` directly rather than `Overlay<T, K>`
	 * because game passes have no user-supplied identity key (Open Cloud mints
	 * the asset ID). The `redacted` field accepts the same shape it does at the
	 * root entry: a boolean toggle or a {@link RedactedGamePassOverride}
	 * carrying per-field overrides for this resource in this environment.
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
	 * `productId`). The `redacted` field accepts the same shape it does
	 * at the root entry: a boolean toggle or a
	 * {@link RedactedDeveloperProductOverride} carrying per-field
	 * overrides for this resource in this environment.
	 */
	products?: Record<string, Partial<DeveloperProductEntry>>;
	/**
	 * Per-environment redaction layer. Accepts a boolean toggle or a
	 * {@link RedactedEnvironmentOverride} carrying cross-kind override
	 * fields. Per-resource `redacted` flags on the merged config take
	 * precedence per field; `false` at any layer carves out at that
	 * layer.
	 */
	redacted?: boolean | RedactedEnvironmentOverride | undefined;
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
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { ResourceEntryByKind } from "@bedrock-rbx/core/config";
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
 *
 * @since 0.1.0
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
 * Opt-in code-generation policy. When `enabled`, `deploy` assembles the
 * current state of every declared environment after the new state is
 * written and hands it to the caller-supplied emitter, writing the returned
 * files under `output`. Codegen runs whenever the state write succeeds —
 * including after a partial apply failure, in which case it emits only the
 * keys that resolved while `deploy` still returns `applyFailed`. Absent or
 * `enabled: false` keeps Mantle-parity behaviour (state only; consumption is
 * the user's problem).
 *
 * The emitter itself is supplied programmatically through `DeployOptions`,
 * not here: an emitter is arbitrary code, so it cannot round-trip through a
 * YAML/JSON config. This section carries only the declarative switch and the
 * output location.
 *
 * @since 0.1.0
 */
export interface CodegenConfig {
	/**
	 * Whether codegen runs once the deploy's state write succeeds. Treat
	 * `undefined` as disabled; set `true` to opt in.
	 */
	enabled?: boolean | undefined;
	/**
	 * Directory the generated files are written under, resolved relative to
	 * the working directory. Each emitted file's path is joined onto this
	 * base. Used by the default node-fs writer; ignored when a writer is
	 * injected through `DeployOptions`. Defaults to `.bedrock/generated`
	 * whenever codegen is enabled and no writer is injected — including when
	 * a custom `emit` override is supplied — so a directory is only required
	 * to override that default.
	 */
	output?: string | undefined;
	/**
	 * Whether the default emitter also writes a `resources.d.ts` declaration
	 * beside the Luau module so roblox-ts consumers get type-safety over the
	 * same constants. Treat `undefined` as `false`. Ignored when a custom
	 * `emit` override is supplied through `DeployOptions`.
	 */
	typeDeclarations?: boolean | undefined;
}

/**
 * Helper that produces a shallow `Omit<T, K>` without using TypeScript's
 * built-in `Omit` (deprecated under the project's lint rules because of
 * its lossy interaction with mapped types).
 *
 * @template T - Source type to project keys away from.
 * @template Key - Key (or union of keys) on `T` to remove.
 */
export type WithoutKey<T, Key extends keyof T> = Pick<T, Exclude<keyof T, Key>>;

/**
 * Per-environment universe overlay shape that prevents `universeId` from
 * being redeclared alongside a root-authoritative `universeId`.
 * Used by {@link ConfigRootUniverseId}: when the root universe block
 * declares `universeId`, no per-env overlay may redeclare it. Setting
 * `universeId` here produces a descriptive type error pointing at this
 * field rather than the opaque `never` message.
 *
 * @since 0.1.0
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
 *
 * @since 0.1.0
 */
export type UniverseOverlayWithId = Partial<WithoutKey<UniverseEntry, "universeId">> & {
	universeId: string;
};

/**
 * Variant of `Config` where the root `universe` block declares
 * `universeId`. Per-environment universe overlays may carry shared
 * fields (device flags, social links, display name) but cannot
 * redeclare `universeId`; the schema rejects any env overlay that
 * does. The runtime `selectEnvironment` merges shared-field overlays
 * onto the root and inherits `universeId` from the root unchanged.
 *
 * @since 0.1.0
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
 *
 * @since 0.1.0
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
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { Config } from "@bedrock-rbx/core/config";
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
 *
 * @since 0.1.0
 */
export interface ResolvedUniverseEntry extends Pick<
	UniverseEntry,
	Exclude<keyof UniverseEntry, "universeId">
> {
	/**
	 * Existing Roblox universe ID, resolved from the root or per-environment
	 * overlay.
	 */
	universeId: string;
}

/**
 * Project config after `selectEnvironment` has merged a single
 * environment's overlays onto the root. The shape mirrors `Config`
 * except `places` carries `ResolvedPlaceEntry` (`placeId` present, with
 * `filePath` present only for a file-backed place), since the resolver
 * fails before this point if an entry is missing its
 * environment-supplied `placeId`. Downstream consumers
 * (`flattenConfig`, `buildDefaultRegistry`, the deploy pipeline) accept
 * this shape rather than `Config` so the post-merge invariant is visible
 * in the type system.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { selectEnvironment, type ResolvedConfig } from "@bedrock-rbx/core";
 * import type { Config } from "@bedrock-rbx/core/config";
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
	/**
	 * Keyed-map collection of resolved place entries; `placeId` is present
	 * on every entry, `filePath` only on the file-backed ones.
	 */
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
 * Fields shared by every {@link Config} variant. The discriminated
 * `Config` union narrows `universe` and `environments` to enforce the
 * `universeId` XOR rule between the root and per-environment overlays;
 * everything else lives here.
 */
interface ConfigBase {
	/** Opt-in code-generation policy; omitted keeps Mantle-parity behaviour. */
	codegen?: CodegenConfig;
	/**
	 * Project-level prefixing of universe and place display names with the
	 * environment label. Default behaviour (when omitted) is enabled with a
	 * `"[{LABEL}] "` template; set `enabled: false` to opt out, or set
	 * `format` to a custom template.
	 */
	displayNamePrefix?: DisplayNamePrefixConfig;
	/** Reserved at the root for c12's config layering / overlay work. */
	extends?: unknown;
	/**
	 * Keyed-map collection of game-pass entries by user-supplied ResourceKey.
	 */
	passes?: Record<string, GamePassEntry>;
	/** Keyed-map collection of place entries by user-supplied ResourceKey. */
	places?: Record<string, PlaceEntry>;
	/**
	 * Module specifiers of the plugins this project uses. Each is imported
	 * while the config loads, before the rest of the config is validated, so
	 * a plugin failing to import fails the load rather than surfacing later.
	 *
	 * A specifier resolves from the directory holding this config file, so
	 * a package name finds a plugin the project installed, and a relative
	 * path finds one kept alongside the config.
	 *
	 * A config authored in TypeScript may list the plugin itself, which is
	 * what types its `state` block from what that plugin declares. That
	 * form is accepted by `defineConfig`; by the time a config reaches
	 * here every entry is a string, since a plugin listed by value is
	 * recorded under the name it declares.
	 */
	plugins?: ReadonlyArray<string>;
	/**
	 * Keyed-map collection of developer-product entries by user-supplied
	 * ResourceKey.
	 */
	products?: Record<string, DeveloperProductEntry>;
	/**
	 * Where Bedrock persists state for this project; required at deploy time.
	 */
	state?: StateConfig;
}

/**
 * Narrow a `StateConfig` to the `GistStateConfig` arm. The `(string & {})`
 * autocomplete idiom prevents TypeScript from narrowing on
 * `backend === "gist"` alone, so dispatch sites use this guard to
 * preserve the `gistId` field shape.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { isGistStateConfig } from "@bedrock-rbx/core";
 * import type { StateConfig } from "@bedrock-rbx/core/config";
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

const REDACTED_KEY = "redacted?";

const NON_EMPTY_OVERRIDE_MESSAGE =
	"a non-empty override object; use `redacted: true` for default placeholders";

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

const gamePassRedactedOverride = type({
	"description?": "string",
	"icon?": iconMap,
	"name?": "string",
	"price?": OPTIONAL_ROBUX_PRICE,
})
	.onUndeclaredKey("reject")
	.narrow((value, ctx) => {
		if (Object.keys(value).length === 0) {
			return ctx.mustBe(NON_EMPTY_OVERRIDE_MESSAGE);
		}

		return true;
	});

const gamePassRedacted = gamePassRedactedOverride.or(OPTIONAL_BOOLEAN);

const placeRedactedOverride = type({
	"description?": "string",
	"displayName?": "string",
})
	.onUndeclaredKey("reject")
	.narrow((value, ctx) => {
		if (Object.keys(value).length === 0) {
			return ctx.mustBe(NON_EMPTY_OVERRIDE_MESSAGE);
		}

		return true;
	});

const placeRedacted = placeRedactedOverride.or(OPTIONAL_BOOLEAN);

const productRedactedOverride = type({
	"description?": "string",
	"icon?": iconMap,
	"name?": "string",
	"price?": OPTIONAL_ROBUX_PRICE,
})
	.onUndeclaredKey("reject")
	.narrow((value, ctx) => {
		if (Object.keys(value).length === 0) {
			return ctx.mustBe(NON_EMPTY_OVERRIDE_MESSAGE);
		}

		return true;
	});

const productRedacted = productRedactedOverride.or(OPTIONAL_BOOLEAN);

const environmentRedactedOverride = type({
	"description?": "string",
	"displayName?": "string",
	"icon?": iconMap,
	"name?": "string",
	"price?": OPTIONAL_ROBUX_PRICE,
})
	.onUndeclaredKey("reject")
	.narrow((value, ctx) => {
		if (Object.keys(value).length === 0) {
			return ctx.mustBe(NON_EMPTY_OVERRIDE_MESSAGE);
		}

		return true;
	});

const environmentRedacted = environmentRedactedOverride.or(OPTIONAL_BOOLEAN);

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
	[REDACTED_KEY]: gamePassRedacted,
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
	[REDACTED_KEY]: productRedacted,
	"storePageEnabled?": OPTIONAL_BOOLEAN,
}).onUndeclaredKey("reject");

const productsCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: developerProductEntry,
}).onUndeclaredKey("reject");

const ROBLOX_ID_DIGITS = "string.digits";

const placeEntry = type({
	"description?": OPTIONAL_STRING,
	"displayName?": OPTIONAL_STRING,
	"filePath?": OPTIONAL_STRING,
	[REDACTED_KEY]: placeRedacted,
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

// The `state` keys core owns whatever the backend is, merged into every
// plugin fragment so a plugin never declares them.
const STATE_BACKEND_BASE = { "backend": "string", "locking?": "boolean" } as const;

// The shape every backend core knows about accepts, and the shape an
// unrecognized backend name falls back to so a config can name a backend
// this build has no declaration for.
const BUILTIN_STATE_SCHEMA = type({
	...STATE_BACKEND_BASE,
	"gistId?": "string > 0",
}).onUndeclaredKey("reject");

/**
 * One field-level problem to attribute, in the shape both the XOR collector
 * and an `ArkErrors` entry already have.
 */
interface AttributableIssue {
	/** Human-readable explanation of the problem. */
	readonly message: string;
	/** Path to the offending field, relative to the reporting narrow. */
	readonly path: ReadonlyArray<PropertyKey>;
}

/**
 * The slice of arktype's traversal context {@link attributeIssues} needs.
 * Structural so it does not reach into `@ark/schema`, which arktype does
 * not re-export.
 */
interface IssueSink {
	/** Path of the value currently being traversed. */
	readonly path: ReadonlyArray<PropertyKey>;
	/** Record one problem against the value being traversed. */
	readonly reject: (issue: { message: string; path: ReadonlyArray<PropertyKey> }) => false;
}

/**
 * Whether a value is a fragment {@link composeStateBackendSchema} can merge,
 * which an arktype schema over anything but an object is not.
 *
 * Answered by attempting the merge through arktype's untyped parser rather
 * than by inspecting the value, so the answer tracks what the composition
 * actually accepts. A plugin is ordinary JavaScript at runtime, so the
 * declared type is no guarantee, and an unmergeable fragment left to reach
 * the composition throws out of `loadConfig` instead of failing the load
 * with a typed error.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 *
 * @param fragment - The raw `schema` value read off a plugin's declaration.
 * @returns `true` when the fragment merges.
 */
export function isStateBackendSchema(fragment: unknown): boolean {
	try {
		// arktype requires the spread key first.
		type.raw({ "...": fragment, ...STATE_BACKEND_BASE });
		return true;
	} catch {
		return false;
	}
}

/**
 * Check one `state` block against the **Backend** its `backend` key names.
 *
 * A block assembled from somewhere other than a config file, such as the
 * flags `bedrock state move` reads its destination off, otherwise reaches
 * a **Backend** builder unchecked: a missing coordinate would surface as
 * an opaque request failure against a store nothing addresses.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 *
 * @param value - The assembled block, including its `backend` key.
 * @param registry - What the loaded plugins declared, which decides which
 * keys count as declared.
 * @returns The validated block, or every problem attributed to its key.
 */
export function parseStateConfig(
	value: unknown,
	registry: PluginRegistry,
): Result<StateConfig, ReadonlyArray<ConfigValidationIssue>> {
	const checked = buildStateSchema(registry)(value);
	if (checked instanceof ArkErrors) {
		const issues = Array.from(checked, (issue) => {
			return {
				message: issue.message,
				path: Array.from(issue.path, (segment) => String(segment)),
			};
		});

		return { err: issues, success: false };
	}

	return { data: checked, success: true };
}

/**
 * Merge one plugin's fragment with the key core owns, producing the schema
 * a `state` block naming that **Backend** validates against.
 *
 * @param fragment - The plugin's own declaration for its `state` keys.
 * @returns The composed block schema, rejecting every undeclared key.
 */
function composeStateBackendSchema(fragment: StateBackendSchema): Type<object> {
	return type(STATE_BACKEND_BASE).merge(fragment).onUndeclaredKey("reject");
}

/**
 * Attribute every issue to its own field. `ctx.path` re-roots each issue
 * under wherever the narrow sits, so a bad value lands on the field
 * carrying it rather than on the block as a whole.
 *
 * @param ctx - Traversal context of the narrow reporting the issues.
 * @param issues - Issues to attribute; empty when the value is valid.
 */
function attributeIssues(ctx: IssueSink, issues: ReadonlyArray<AttributableIssue>): void {
	for (const issue of issues) {
		ctx.reject({ message: issue.message, path: [...ctx.path, ...issue.path] });
	}
}

/**
 * Build the schema for one `state` block, dispatching on the authored
 * `backend` value so a plugin's fragment validates only the block that
 * named that plugin's backend.
 *
 * Dispatching rather than a union of arms is what keeps a failure
 * attributed to the offending field: a union reports one aggregate message
 * against the block itself.
 *
 * @param registry - What the loaded plugins declared.
 * @returns The `state` block schema for this set of plugins.
 */
function buildStateSchema(registry: PluginRegistry): Type<StateConfig> {
	const byBackend = new Map(
		Array.from(registry.stateBackends, ([name, registered]) => {
			return [name, composeStateBackendSchema(registered.declaration.schema)];
		}),
	);

	return type("object").narrow((value, ctx): value is StateConfig => {
		const backend = Reflect.get(value, "backend");
		const schema =
			(typeof backend === "string" ? byBackend.get(backend) : undefined) ??
			BUILTIN_STATE_SCHEMA;

		const checked = schema(value);
		if (checked instanceof ArkErrors) {
			attributeIssues(ctx, [...checked]);
		}

		// A rejected issue is what fails the value; this predicate's own
		// return says only what a value that was not rejected narrowed to.
		return true;
	});
}

const codegenConfig: Type<CodegenConfig> = type({
	"enabled?": OPTIONAL_BOOLEAN,
	"output?": OPTIONAL_STRING,
	"typeDeclarations?": OPTIONAL_BOOLEAN,
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
	[REDACTED_KEY]: gamePassRedacted,
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
	[REDACTED_KEY]: productRedacted,
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
	[REDACTED_KEY]: placeRedacted,
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

/**
 * Build the schema for one entry under `environments`.
 *
 * @param stateSchema - Schema for this environment's `state` override.
 * @returns The environment-entry schema.
 */
function buildEnvironmentEntry(stateSchema: Type<StateConfig>): Type<EnvironmentEntry> {
	return type({
		"label?": OPTIONAL_STRING,
		"passes?": passesOverlayCollection,
		"places?": placesOverlayCollection,
		"products?": productsOverlayCollection,
		[REDACTED_KEY]: environmentRedacted,
		"state?": stateSchema,
		"universe?": universeOverlay,
	}).onUndeclaredKey("reject");
}

const displayNamePrefix: Type<DisplayNamePrefixConfig> = type({
	"enabled?": OPTIONAL_BOOLEAN,
	"format?": OPTIONAL_STRING,
}).onUndeclaredKey("reject");

/**
 * Validator for a parsed config value. Returns the validated `Config` on
 * success or a `validationFailed` `ConfigError` with one issue per
 * problem, each attributed to a field path. `sourceFile` appears in the
 * error so callers can point a human at the offending file.
 *
 * @since 0.2.0
 */
export type ConfigValidator = (input: unknown, sourceFile: string) => Result<Config, ConfigError>;

/**
 * Compile a config validator that knows what the loaded plugins declared,
 * so a `state` block carrying a plugin backend's own keys validates.
 *
 * The schema is compiled once per call, so build one validator per config
 * load rather than one per value checked.
 *
 * @since 0.2.0
 *
 * @param registry - What the loaded plugins declared, which decides which
 * `state` keys count as declared.
 * @returns A validator honouring those declarations.
 * @example
 *
 * ```ts
 * import { createConfigValidator } from "@bedrock-rbx/core";
 * import type { StateBackendDeclaration } from "@bedrock-rbx/core";
 *
 * import { type } from "arktype";
 *
 * const s3: StateBackendDeclaration = {
 *     name: "s3",
 *     schema: type({ bucket: "string > 0" }),
 *     createPort: () => ({ err: { reason: "example only" }, success: false }),
 * };
 *
 * const validate = createConfigValidator({
 *     stateBackends: new Map([["s3", { declaration: s3, specifier: "@example/state-s3" }]]),
 * });
 *
 * const result = validate(
 *     { environments: { production: {} }, state: { backend: "s3", bucket: "my-bucket" } },
 *     "bedrock.config.ts",
 * );
 *
 * expect(result.success).toBeTrue();
 * ```
 */
export function createConfigValidator(registry: PluginRegistry): ConfigValidator {
	const schema = buildRootSchema(registry);

	return function validateConfig(input, sourceFile) {
		const validated = schema(input);
		if (validated instanceof ArkErrors) {
			const issues = Array.from(validated, (issue) => {
				return {
					message: issue.message,
					path: Array.from(issue.path, (segment) => String(segment)),
				};
			});

			return {
				err: { issues, kind: "validationFailed", sourceFile },
				success: false,
			};
		}

		// The runtime narrow rejects every value violating the universeId XOR
		// rule, so a successful validation always lands in one arm of the
		// discriminated `Config` union. It cannot be constructed rather than
		// asserted: `ConfigEnvironmentUniverseId` types the root `universeId`
		// as a phantom error-brand (`… & { errorBrand: never }`) so authoring
		// a config in TypeScript reports the XOR violation as a readable
		// message. No runtime value can inhabit that brand, so no sound
		// construction of that arm exists; the assertion is what bridges
		// validated data to the authoring-time type.
		// eslint-disable-next-line ts/no-unsafe-type-assertion -- target arm carries a compile-time-only error brand
		return { data: validated as unknown as Config, success: true };
	};
}

/**
 * Validate a parsed config value against the runtime schema, knowing only
 * the backends core ships. Use {@link createConfigValidator} when plugins
 * may have declared backends of their own.
 *
 * @since 0.1.0
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
 * import { validateConfig } from "@bedrock-rbx/core";
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
export const validateConfig: ConfigValidator = createConfigValidator(EMPTY_PLUGIN_REGISTRY);

/**
 * Build the schema for the `environments` collection.
 *
 * @param stateSchema - Schema for each environment's `state` override.
 * @returns The environments-collection schema.
 */
function buildEnvironmentsCollection(
	stateSchema: Type<StateConfig>,
): Type<Record<string, EnvironmentEntry>> {
	return type({
		[`[/${ENV_NAME_PATTERN_SOURCE}/]`]: buildEnvironmentEntry(stateSchema),
	})
		.onUndeclaredKey("reject")
		.narrow((value, ctx) => {
			if (Object.keys(value).length === 0) {
				return ctx.mustBe("an environments record with at least one declared environment");
			}

			return true;
		});
}

/**
 * Build the root config schema.
 *
 * The result is intentionally not annotated `Type<Config>` because
 * `Config` is a discriminated union enforcing the universeId XOR rule at
 * the type level. The arktype schema describes the loose authored-shape
 * that's structurally a supertype of every union arm; the runtime narrow
 * rejects any value that doesn't satisfy one arm so `validateConfig` can
 * cast the result to `Config` safely. Splitting the schema into two
 * `.or()` variants would mirror the type union but duplicate every field
 * declaration without buying additional runtime coverage on top of the
 * narrow.
 *
 * @param registry - What the loaded plugins declared, which decides which
 * `state` keys count as declared.
 * @returns The root schema to validate a parsed config against.
 */
function buildRootSchema(registry: PluginRegistry): Type<object> {
	const stateSchema = buildStateSchema(registry);

	return type({
		"codegen?": codegenConfig,
		"displayNamePrefix?": displayNamePrefix,
		"environments": buildEnvironmentsCollection(stateSchema),
		"extends?": "unknown",
		"passes?": passesCollection,
		"places?": placesCollection,
		"plugins?": "string[] | undefined",
		"products?": productsCollection,
		"state?": stateSchema,
		"universe?": universeEntry,
	})
		.onUndeclaredKey("reject")
		.narrow((value, ctx) => {
			attributeIssues(ctx, collectUniverseIdIssues(value));

			// As in the `state` block above: rejecting is what fails the
			// value, so this narrow reports no verdict of its own.
			return true;
		});
}
