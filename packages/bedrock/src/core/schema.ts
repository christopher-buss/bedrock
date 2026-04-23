import type { Result } from "@bedrock/ocale";

import { ArkErrors, type, type Type } from "arktype";

import { RESOURCE_KEY_PATTERN_SOURCE } from "../types/ids.ts";
import type { ConfigError, ConfigValidationIssue } from "./config-error.ts";

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
 * import type { Config } from "bedrock";
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
	/** Reserved at the root for experience-level singleton metadata. */
	experience?: unknown;
	/** Reserved at the root for c12's config layering / overlay work. */
	extends?: unknown;
	/** Keyed-map collection of game-pass entries by user-supplied ResourceKey. */
	passes?: Record<string, GamePassEntry>;
	/** Keyed-map collection of place entries by user-supplied ResourceKey. */
	places?: Record<string, PlaceEntry>;
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

const rootSchema: Type<Config> = type({
	"environments?": "unknown",
	"experience?": "unknown",
	"extends?": "unknown",
	"passes?": passesCollection,
	"places?": placesCollection,
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
 * import { validateConfig } from "bedrock";
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
		const issues: Array<ConfigValidationIssue> = [];
		for (const issue of validated) {
			issues.push({
				message: issue.message,
				path: [...issue.path].map((segment) => String(segment)),
			});
		}

		return {
			err: { issues, kind: "validationFailed", sourceFile },
			success: false,
		};
	}

	return { data: validated, success: true };
}
