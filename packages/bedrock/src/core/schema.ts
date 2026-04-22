import type { Result } from "@bedrock/ocale";

import { ArkErrors, type } from "arktype";

import type { ConfigError, ConfigValidationIssue } from "./config-error.ts";

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
	"[/^[A-Za-z0-9_-]+$/]": gamePassEntry,
}).onUndeclaredKey("reject");

const rootSchema = type({
	"environments?": "unknown",
	"experience?": "unknown",
	"extends?": "unknown",
	"passes?": passesCollection,
}).onUndeclaredKey("reject");

/**
 * Validated, mutable project config as accepted by `loadConfig`.
 *
 * Inferred from the runtime schema, so the TypeScript type and the validator
 * never drift apart. Adding a new resource kind to the schema widens this
 * type automatically.
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
export type Config = typeof rootSchema.infer;

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
				path: [...issue.path].map((segment) => {
					return typeof segment === "number" || typeof segment === "string"
						? segment
						: String(segment);
				}),
			});
		}

		return {
			err: { issues, kind: "validationFailed", sourceFile },
			success: false,
		};
	}

	return { data: validated, success: true };
}
