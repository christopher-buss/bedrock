/**
 * Single validation problem reported by the schema validator. `path` is the
 * sequence of keys and indices into the config root; `message` is a
 * human-readable explanation.
 *
 * @example
 *
 * ```ts
 * import type { ConfigValidationIssue } from "bedrock";
 *
 * const issue: ConfigValidationIssue = {
 *     message: "must be a number",
 *     path: ["passes", "vip-pass", "price"],
 * };
 *
 * expect(issue.path).toStrictEqual(["passes", "vip-pass", "price"]);
 * ```
 */
export interface ConfigValidationIssue {
	/** Human-readable explanation of why this field failed validation. */
	readonly message: string;
	/** Sequence of keys and indices from the config root to the offending field. */
	readonly path: ReadonlyArray<number | string>;
}

/**
 * Failure surfaced by `loadConfig` when a project config cannot be resolved,
 * parsed, or validated. Plain-data discriminated union; narrow on `kind`
 * rather than using `instanceof`.
 *
 * Current cases:
 * - `fileNotFound` - no `bedrock.config.*` (or other c12-discovered file)
 *   was found starting from the working directory.
 * - `validationFailed` - a config file was found and parsed, but its content
 *   did not satisfy the runtime schema. `issues` attributes each problem to
 *   a field path so callers can point at the offending entry.
 *
 * Additional cases (distinct parse errors, config-function throws) land with
 * the issues that introduce those flows.
 *
 * @example
 *
 * ```ts
 * import type { ConfigError } from "bedrock";
 *
 * function describe(err: ConfigError): string {
 *     switch (err.kind) {
 *         case "fileNotFound": {
 *             return `no bedrock config under ${err.searchedFrom}`;
 *         }
 *         case "validationFailed": {
 *             const first = err.issues[0];
 *             return first
 *                 ? `${err.sourceFile}: ${first.path.join(".")} ${first.message}`
 *                 : `${err.sourceFile}: invalid`;
 *         }
 *     }
 * }
 *
 * expect(describe({ kind: "fileNotFound", searchedFrom: "/proj" })).toBe(
 *     "no bedrock config under /proj",
 * );
 * expect(
 *     describe({
 *         kind: "validationFailed",
 *         sourceFile: "bedrock.config.ts",
 *         issues: [{ path: ["passes", "vip", "price"], message: "must be a number" }],
 *     }),
 * ).toBe("bedrock.config.ts: passes.vip.price must be a number");
 * ```
 */
export type ConfigError =
	| {
			readonly issues: ReadonlyArray<ConfigValidationIssue>;
			readonly kind: "validationFailed";
			readonly sourceFile: string;
	  }
	| {
			readonly kind: "fileNotFound";
			readonly searchedFrom: string;
	  };
