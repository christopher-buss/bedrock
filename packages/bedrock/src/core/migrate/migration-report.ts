import type { ConfigError } from "../config-error.ts";
import type { Config } from "../schema.ts";
import type { BedrockState } from "../state.ts";

/**
 * Per-environment in-memory state snapshot map keyed by environment name.
 *
 * `Record` rather than `Map` so the field survives `JSON.stringify` for
 * downstream logging and parallel-iterates cleanly with
 * `Config.environments` (which is itself a `Record`).
 *
 * @since 0.1.0
 */
export type StatesByEnvironment = Readonly<Record<string, BedrockState>>;

/**
 * Aggregate counts for the four `MigrationWarning` kinds. Computed by
 * folding `MigrationReport.warnings`; lets a CI gate skim totals without
 * iterating every entry. All fields are zero on a clean migration.
 *
 * @since 0.1.0
 */
export interface MigrationSummary {
	/** Number of `ambiguous` warnings emitted. */
	readonly ambiguousCount: number;
	/** Number of `blocked` warnings emitted. */
	readonly blockedCount: number;
	/** Number of `deferred` warnings emitted. */
	readonly deferredCount: number;
	/** Number of `interpretive` warnings emitted. */
	readonly interpretiveCount: number;
}

/**
 * Discriminated union describing one observation the migrator made about a
 * Mantle field that did not flow straight into bedrock config or state.
 *
 * - `deferred` - bedrock plans to support the field once the matching
 *   resource kind ships; the migration is non-destructive.
 * - `blocked` - no Open Cloud writable endpoint exists; Mantle was using a
 *   cookie or legacy API that bedrock cannot call.
 * - `interpretive` - the migrator applied a documented mapping rule
 *   (cross-field fold, list-to-flag rewrite, URL-domain dispatch). Each
 *   rule names the bedrock-side path it produced and the rule it followed
 *   so the user can audit.
 * - `ambiguous` - the field is mappable but unsafe to act on without
 *   user input; the migrator carries the hint forward instead of guessing.
 *
 * Every variant carries `mantlePath` rooted at the environment so the
 * report is searchable (for example
 * `production.experienceConfiguration_singleton.genre`).
 *
 * @since 0.1.0
 */
export type MigrationWarning =
	| {
			readonly bedrockPath: string;
			readonly kind: "interpretive";
			readonly mantlePath: string;
			readonly rule: string;
	  }
	| { readonly hint: string; readonly kind: "ambiguous"; readonly mantlePath: string }
	| { readonly kind: "blocked"; readonly mantlePath: string; readonly reason: string }
	| { readonly kind: "deferred"; readonly mantlePath: string; readonly reason: string };

/**
 * Failure surfaced by `migrateMantleState`. Plain-data discriminated
 * union; narrow on `kind` rather than using `instanceof`.
 *
 * - `stateFileNotFound` - `deps.readFile` threw with `code: "ENOENT"`;
 *   the file does not exist at the supplied path. Permission failures
 *   (`EACCES`, `EPERM`) and other I/O errors are re-thrown rather than
 *   wrapped here, so callers see the original code on the rejection.
 * - `stateParseFailed` - the YAML parser refused the file's contents.
 * - `unsupportedMantleStateVersion` - the parsed file's `version` field is
 *   not one of the values in `supported`. V0.1 supports `"6"` only; older
 *   versions need to be upgraded with any recent Mantle release first.
 * - `primaryEnvironmentRequired` - the input has more than one environment
 *   and `deps.primaryEnvironment` was not supplied. The migrator refuses
 *   to silently pick a winner.
 * - `primaryEnvironmentNotFound` - `deps.primaryEnvironment` does not match
 *   any environment in the input.
 * - `internalError` - the migrator's own emitted config failed
 *   `validateConfig`; `cause` carries the `ConfigError` so callers can
 *   inspect each `validationFailed` issue. Defensive bug catcher that
 *   callers should never see in practice.
 *
 * @since 0.1.0
 */
export type MigrateError =
	| {
			readonly available: ReadonlyArray<string>;
			readonly kind: "primaryEnvironmentNotFound";
			readonly primary: string;
	  }
	| { readonly available: ReadonlyArray<string>; readonly kind: "primaryEnvironmentRequired" }
	| { readonly cause: ConfigError; readonly kind: "internalError"; readonly reason: string }
	| {
			readonly found: string;
			readonly kind: "unsupportedMantleStateVersion";
			readonly supported: ReadonlyArray<string>;
	  }
	| { readonly kind: "stateFileNotFound"; readonly path: string }
	| { readonly kind: "stateParseFailed"; readonly path: string; readonly reason: string };

/**
 * Result returned by a successful `migrateMantleState` call.
 *
 * `config` is the bedrock-shape projection of the Mantle state file,
 * already validated against the runtime schema (a failure to validate
 * surfaces as `MigrateError.internalError`, not as a returned report).
 *
 * `configFileContent` is the same data rendered as TypeScript source
 * (`defineConfig({...})`) so the caller can write it straight to disk
 * without re-serializing. `loadConfig` round-trips it cleanly.
 *
 * `statesByEnvironment` carries one in-memory `BedrockState` per
 * environment from the input. Truthful per environment (no factorization)
 * so `bedrock deploy --env=<env>` produces zero ops on first run.
 *
 * `warnings` and `summary` describe what the migrator did *not* migrate
 * verbatim, classified for triage. The skeleton emits no warnings.
 *
 * @since 0.1.0
 */
export interface MigrationReport {
	/** Validated bedrock config built from the Mantle state file. */
	readonly config: Config;
	/** Same `config` rendered as TypeScript source the caller can write to disk. */
	readonly configFileContent: string;
	/** One `BedrockState` per environment in the input, keyed by environment name. */
	readonly statesByEnvironment: StatesByEnvironment;
	/** Aggregate counts of `warnings` by kind. */
	readonly summary: MigrationSummary;
	/** One entry per non-trivial mapping or skipped Mantle field. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

/**
 * Subset of {@link MigrationReport} written to disk as
 * `.bedrock/migration-report.json`. Both the JSON serializer and the
 * Markdown renderer consume this exact shape, so the Markdown view
 * round-trips through the JSON file: anyone parsing the JSON receives an
 * equivalent value the renderer can re-render.
 */
export interface MigrationReportFile {
	/** Aggregate counts by warning kind. */
	readonly summary: MigrationSummary;
	/** Every warning the migrator emitted, in input order. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}
