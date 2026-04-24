import type { Result } from "@bedrock/ocale";

import { ArkErrors, type, type Type } from "arktype";

import { RESOURCE_KEY_PATTERN_SOURCE } from "../types/ids.ts";
import type { ConfigError } from "./config-error.ts";

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
	 * Display name for the universe. Because Roblox derives this from
	 * the root place's name, the driver routes the update through
	 * `PlacesClient.update`; omit or set `undefined` to leave unmanaged.
	 */
	displayName?: string | undefined;
	/** Whether mobile players can join; omit or set `undefined` to leave unmanaged. */
	mobileEnabled?: boolean | undefined;
	/**
	 * Private-server price in Robux. Declare as `undefined` to disable
	 * private servers (cancels active subscriptions); omit to leave the
	 * server value untouched.
	 */
	privateServerPriceRobux?: number | undefined;
	/** Whether tablet players can join; omit or set `undefined` to leave unmanaged. */
	tabletEnabled?: boolean | undefined;
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
}

/**
 * Validated project config as accepted by `loadConfig`. Plain mutable so
 * users can adjust fields in a long-running script before deploying.
 *
 * Shape matches the runtime schema declared below. `rootSchema` is typed
 * against this interface via `Type<Config>`, so any drift between the two
 * is a compile error at build time.
 *
 * @example
 *
 * ```ts
 * import type { Config } from "@bedrock/core";
 *
 * const config: Config = {
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
	/** Reserved at the root for the per-environment modeling tracked in #110. */
	environments?: unknown;
	/** Reserved at the root for c12's config layering / overlay work. */
	extends?: unknown;
	/** Keyed-map collection of game-pass entries by user-supplied ResourceKey. */
	passes?: Record<string, GamePassEntry>;
	/** Keyed-map collection of place entries by user-supplied ResourceKey. */
	places?: Record<string, PlaceEntry>;
	/** Singleton universe block declaring the Roblox universe bedrock manages. */
	universe?: UniverseEntry;
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

const placeEntry = type({
	filePath: "string",
	placeId: "string.digits",
}).onUndeclaredKey("reject");

const placesCollection = type({
	[`[/${RESOURCE_KEY_PATTERN_SOURCE}/]`]: placeEntry,
}).onUndeclaredKey("reject");

const OPTIONAL_BOOLEAN = "boolean | undefined";

const universeEntry = type({
	"consoleEnabled?": OPTIONAL_BOOLEAN,
	"desktopEnabled?": OPTIONAL_BOOLEAN,
	"displayName?": "string | undefined",
	"mobileEnabled?": OPTIONAL_BOOLEAN,
	"privateServerPriceRobux?": "number.integer >= 0 | undefined",
	"tabletEnabled?": OPTIONAL_BOOLEAN,
	"universeId": "string.digits",
	"visibility?": "'private' | 'public' | 'unspecified' | undefined",
	"voiceChatEnabled?": OPTIONAL_BOOLEAN,
	"vrEnabled?": OPTIONAL_BOOLEAN,
}).onUndeclaredKey("reject");

const rootSchema: Type<Config> = type({
	"environments?": "unknown",
	"extends?": "unknown",
	"passes?": passesCollection,
	"places?": placesCollection,
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
 *     { passes: { "vip-pass": { name: "VIP" } } },
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
