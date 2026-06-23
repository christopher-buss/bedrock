/**
 * Single validation problem reported by the schema validator. `path` is the
 * sequence of keys and indices into the config root; `message` is a
 * human-readable explanation.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { ConfigValidationIssue } from "@bedrock-rbx/core";
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
	/** Sequence of keys from the config root to the offending field. */
	readonly path: ReadonlyArray<string>;
}

/**
 * Failure surfaced by `loadConfig` when a project config cannot be resolved,
 * parsed, or validated. Plain-data discriminated union; narrow on `kind`
 * rather than using `instanceof`.
 *
 * Current cases:
 * - `fileNotFound` - no `bedrock.config.*` (or other c12-discovered file)
 *   was found starting from the working directory.
 * - `parseFailed` - a config file was found but could not be parsed (for
 *   example, malformed YAML or JSON). `message` carries the underlying
 *   parser message verbatim.
 * - `validationFailed` - a config file was found and parsed, but its content
 *   did not satisfy the runtime schema. `issues` attributes each problem to
 *   a field path so callers can point at the offending entry.
 * - `configFunctionFailed` - a function-form config threw or its returned
 *   promise rejected while being invoked. `message` carries the thrown
 *   error's message verbatim.
 * - `luauRuntimeMissing` - a `bedrock.config.luau` file was found but the
 *   `lute` runtime needed to evaluate it could not be located on PATH or
 *   via the `BEDROCK_LUTE_PATH` environment variable. `hint` carries an
 *   actionable install message.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { ConfigError } from "@bedrock-rbx/core";
 *
 * function describe(err: ConfigError): string {
 *     switch (err.kind) {
 *         case "fileNotFound": {
 *             return `no bedrock config under ${err.searchedFrom}`;
 *         }
 *         case "parseFailed": {
 *             return `${err.sourceFile}: ${err.message}`;
 *         }
 *         case "configFunctionFailed": {
 *             return `${err.sourceFile}: config function threw: ${err.message}`;
 *         }
 *         case "validationFailed": {
 *             const first = err.issues[0];
 *             return first
 *                 ? `${err.sourceFile}: ${first.path.join(".")} ${first.message}`
 *                 : `${err.sourceFile}: invalid`;
 *         }
 *         case "luauRuntimeMissing": {
 *             return `${err.sourceFile}: ${err.hint}`;
 *         }
 *     }
 * }
 *
 * expect(describe({ kind: "fileNotFound", searchedFrom: "/proj" })).toBe(
 *     "no bedrock config under /proj",
 * );
 * expect(
 *     describe({
 *         kind: "parseFailed",
 *         sourceFile: "bedrock.config.yaml",
 *         message: "unexpected end of the stream",
 *     }),
 * ).toBe("bedrock.config.yaml: unexpected end of the stream");
 * expect(
 *     describe({
 *         kind: "configFunctionFailed",
 *         sourceFile: "bedrock.config.ts",
 *         message: "boom",
 *     }),
 * ).toBe("bedrock.config.ts: config function threw: boom");
 * expect(
 *     describe({
 *         kind: "validationFailed",
 *         sourceFile: "bedrock.config.ts",
 *         issues: [{ path: ["passes", "vip", "price"], message: "must be a number" }],
 *     }),
 * ).toBe("bedrock.config.ts: passes.vip.price must be a number");
 * expect(
 *     describe({
 *         kind: "luauRuntimeMissing",
 *         sourceFile: "bedrock.config.luau",
 *         hint: "install lute via mise",
 *     }),
 * ).toBe("bedrock.config.luau: install lute via mise");
 * ```
 */
export type ConfigError =
	| {
			readonly hint: string;
			readonly kind: "luauRuntimeMissing";
			readonly sourceFile: string;
	  }
	| {
			readonly issues: ReadonlyArray<ConfigValidationIssue>;
			readonly kind: "validationFailed";
			readonly sourceFile: string;
	  }
	| {
			readonly kind: "configFunctionFailed";
			readonly message: string;
			readonly sourceFile: string;
	  }
	| {
			readonly kind: "fileNotFound";
			readonly searchedFrom: string;
	  }
	| {
			readonly kind: "parseFailed";
			readonly message: string;
			readonly sourceFile: string;
	  };
