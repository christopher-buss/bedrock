/* eslint-disable max-lines -- single CLI render sink: one exhaustive message arm per error variant across deploy, codegen, migrate, and parse failures; it grows with the error surface and splitting would scatter the cohesive mapping. */
import { NetworkError, type OpenCloudError, PermissionError } from "@bedrock-rbx/ocale";

import type { ConfigError } from "../core/config-error.ts";
import type { MigrateError, MigrationSummary } from "../core/migrate/migration-report.ts";
import type { StateError } from "../core/state.ts";
import type { ApplyError } from "../shell/apply-ops.ts";
import type { BuildDesiredError } from "../shell/build-desired.ts";
import type { MissingCredentialError, UnsupportedBackendError } from "../shell/build-state-port.ts";
import type { DeployError } from "../shell/deploy.ts";
import type { CodegenError } from "../shell/run-codegen.ts";
import type { SpawnOverrideError } from "./dispatch-override.ts";
import type { ParseMigrateError } from "./parse-migrate-options.ts";
import type { ParseOptionsError } from "./parse-options.ts";

/**
 * Output port the CLI renders through. Mirrors the subset of `@clack/prompts`
 * the bedrock CLI uses today; tests inject a fake to assert what was rendered.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { ClackPort } from "@bedrock-rbx/core";
 *
 * const lines: Array<string> = [];
 * const port: ClackPort = {
 *     cancel: (message) => lines.push(`cancel: ${message}`),
 *     intro: (message) => lines.push(`intro: ${message}`),
 *     logError: (message) => lines.push(`error: ${message}`),
 *     logMessage: (message) => lines.push(`log: ${message}`),
 *     logSuccess: (message) => lines.push(`ok: ${message}`),
 *     outro: (message) => lines.push(`outro: ${message}`),
 * };
 *
 * port.logSuccess("done");
 *
 * expect(lines).toEqual(["ok: done"]);
 * ```
 */
export interface ClackPort {
	/** End an interactive flow with a cancellation marker. */
	cancel(message: string): void;
	/** Open a framed section with a title (used for command intros). */
	intro(message: string): void;
	/** Render a single error line inside an open frame. */
	logError(message: string): void;
	/** Render a single neutral line inside an open frame. */
	logMessage(message: string): void;
	/** Render a single success line inside an open frame. */
	logSuccess(message: string): void;
	/** Close the current framed section with a final message. */
	outro(message: string): void;
}

/** Inputs for {@link renderStateWriteError}. */
interface StateWriteErrorRender {
	/** Environment whose state could not be written. */
	readonly environment: string;
	/** The state-error returned by the adapter. */
	readonly err: StateError;
}

/** Inputs for {@link renderMigrationSummary}. */
interface MigrationSummaryRender {
	/** Path to the Markdown report on disk. Pointed at from the action-required and review-needed lines. */
	readonly reportPath: string;
	/** Aggregate counts from a `MigrationReport`. */
	readonly summary: MigrationSummary;
}

/** Inputs for {@link renderOverrideError}. */
interface OverrideErrorRender {
	/** Environment whose override spawn produced the error. */
	readonly environment: string;
	/** The spawn-override error returned by `dispatchOverride`. */
	readonly err: SpawnOverrideError;
}

/**
 * Render a `DeployError` to the supplied `ClackPort`. Most variants emit a
 * single error line; `applyFailed` emits one line per failing op in the
 * aggregate (in Phase 1 then Phase 2 input order). Wrapped variants
 * (`applyFailed`, `buildDesiredFailed`, `codegenFailed`, `configLoadFailed`,
 * `stateReadFailed`, `stateWriteFailed`) surface the inner cause's
 * actionable detail (file path, resource key, parser message, HTTP failure,
 * validator issue) so the reader does not have to inspect the full cause to
 * act.
 * @param err - The deploy error to describe.
 * @param port - The output port the diagnostic is written to.
 */
export function renderDeployError(err: DeployError, port: ClackPort): void {
	if (err.kind === "applyFailed") {
		for (const failure of err.cause.failures) {
			port.logError(`apply failed for '${failure.key}': ${applyCauseDetail(failure)}`);
		}

		return;
	}

	port.logError(deployErrorMessage(err));
}

/**
 * Render a `ParseOptionsError` to the supplied `ClackPort` as a single
 * error line. Each variant names the offending flag so the diagnostic
 * pinpoints what the caller needs to change.
 * @param err - The parse error to describe.
 * @param port - The output port the diagnostic is written to.
 */
export function renderParseError(err: ParseOptionsError, port: ClackPort): void {
	port.logError(parseErrorMessage(err));
}

/**
 * Render a `SpawnOverrideError` to the supplied `ClackPort` as a single
 * error line that names the environment alongside the failure mode. On
 * `launchFailed` the child never produced output of its own, so the parent
 * carries the diagnostic; on `nonZeroExit` the parent's line attributes the
 * exit code to a specific environment when several spawns are running.
 * @param input - Environment + spawn-override error to describe.
 * @param port - The output port the diagnostic is written to.
 */
export function renderOverrideError(input: OverrideErrorRender, port: ClackPort): void {
	port.logError(overrideErrorMessage(input));
}

/**
 * Render the failure surfaced when override discovery throws a non-absence
 * filesystem error (for example `EACCES` on a `.bedrock/<command>.ts` that
 * exists but cannot be read). Discovery refuses to fall through to the
 * built-in path in that case, so the CLI reports the cause and exits rather
 * than crashing on the unhandled throw.
 * @param error - The value thrown during override discovery.
 * @param port - The output port the diagnostic is written to.
 */
export function renderOverrideDiscoveryError(error: unknown, port: ClackPort): void {
	port.logError(`override discovery failed: ${safeStringify(error)}`);
}

/**
 * Render a `ParseMigrateError` to the supplied `ClackPort`. Reuses
 * `parseErrorMessage` for the three flag-shape variants and adds a
 * dedicated message for `unknownSource` listing the supported sources.
 * @param err - The parse error to describe.
 * @param port - The output port the diagnostic is written to.
 */
export function renderMigrateParseError(err: ParseMigrateError, port: ClackPort): void {
	port.logError(migrateParseErrorMessage(err));
}

/**
 * Render a `MigrateError` to the supplied `ClackPort` as a single error
 * line. Each variant points at the offending Mantle state file path,
 * primary-environment input, or wrapped `ConfigError` so the reader can
 * act without inspecting the raw error object.
 * @param err - The migrate error to describe.
 * @param port - The output port the diagnostic is written to.
 */
export function renderMigrateError(err: MigrateError, port: ClackPort): void {
	port.logError(migrateErrorMessage(err));
}

/**
 * Render a `MissingCredentialError` or `UnsupportedBackendError`
 * surfaced when the migrate command tried to default-construct the
 * configured `StatePort` and was missing its inputs.
 * @param err - The error returned by `buildStatePort`.
 * @param port - The output port the diagnostic is written to.
 */
export function renderBuildStatePortError(
	err: MissingCredentialError | UnsupportedBackendError,
	port: ClackPort,
): void {
	port.logError(buildStatePortErrorMessage(err));
}

/**
 * Render the post-migrate review prompt to the supplied `ClackPort`.
 * Three outcomes:
 *
 * - Any `ambiguous` warnings exist: emit a single error line directing
 *   the user to the report. The migration ran but there are decisions
 *   the user still needs to make before deploy will be meaningful.
 * - No `ambiguous` warnings but non-zero `blocked` / `deferred` /
 *   `interpretive`: emit a single success line pointing at the report
 *   for auditing.
 * - All counts zero: silent. The closing `outro("migrate succeeded")`
 *   already speaks for the run.
 * @param input - Counts plus the path of the Markdown report.
 * @param port - The output port the line is written to.
 */
export function renderMigrationSummary(input: MigrationSummaryRender, port: ClackPort): void {
	const { ambiguousCount, blockedCount, deferredCount, interpretiveCount } = input.summary;
	if (ambiguousCount > 0) {
		port.logError(
			`action required: ${String(ambiguousCount)} fields need your input. See ${input.reportPath}`,
		);
		return;
	}

	const reviewable = blockedCount + deferredCount + interpretiveCount;
	if (reviewable > 0) {
		port.logSuccess(
			`migration complete; see ${input.reportPath} for ${String(reviewable)} auto-mapped or skipped fields`,
		);
	}
}

/**
 * Render a `StateError` produced when the migrator wrote a per-environment
 * state through the `StatePort`. Names the environment alongside the
 * adapter's failure reason so the reader knows which write failed.
 * @param input - Environment + state-error to describe.
 * @param port - The output port the diagnostic is written to.
 */
export function renderStateWriteError(input: StateWriteErrorRender, port: ClackPort): void {
	port.logError(
		`state write failed for '${input.environment}' (${input.err.file}): ${input.err.reason}`,
	);
}

function safeStringify(value: unknown): string {
	if (value instanceof Error) {
		return value.message;
	}

	// `String(value)` can throw on null-prototype objects or values whose
	// `toString` / `Symbol.toPrimitive` rejects coercion; fall back so the
	// renderer never crashes mid-diagnostic.
	try {
		return String(value);
	} catch {
		return "<unprintable cause>";
	}
}

function permissionDetail(err: PermissionError): string {
	const isPlural = err.requiredScopes.length > 1;
	const label = isPlural ? "scopes" : "scope";
	const pronoun = isPlural ? "them" : "it";
	const scopeList = err.requiredScopes.map((scope) => `'${scope}'`).join(", ");
	return `${err.message} on ${err.operationKey}: missing required ${label} ${scopeList}. Grant ${pronoun} on the API key at https://create.roblox.com/credentials`;
}

// Walks an error's `cause` chain for the first node-style string `code` (for
// example `"ECONNRESET"`). A fetch transport reset surfaces as
// `NetworkError → TypeError("fetch failed") → OS Error{code}`, so the code sits
// several links down. Capped to avoid looping on a self-referential chain.
// ocale computes this internally but does not export it; the bounded walk is
// reproduced here so the renderer can name the transport failure.
const MAX_CAUSE_DEPTH = 5;

/**
 * Describes the {@link OpenCloudError} behind a driver failure for one
 * diagnostic line. A {@link NetworkError} otherwise collapses every transport
 * failure into the same static `"Network request failed"`; this expands it with
 * the node-style transport `code` (or the underlying cause's message) and the
 * failing `METHOD url`, so an intermittent connection reset reads differently
 * from a DNS failure without inspecting the cause by hand. Every other error
 * surfaces its own `message` unchanged.
 *
 * @param err - The Open Cloud error carried on the failing apply op.
 * @returns A single-line, human-readable failure detail.
 */
export function describeDriverCause(err: OpenCloudError): string {
	if (err instanceof NetworkError) {
		return describeNetworkError(err);
	}

	return err.message;
}

function findTransportCode(error: unknown): string | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
		const code = Reflect.get(current, "code");
		if (typeof code === "string") {
			return code;
		}

		current = current.cause;
	}

	return undefined;
}

function describeNetworkError(err: NetworkError): string {
	const reason =
		findTransportCode(err) ?? (err.cause instanceof Error ? err.cause.message : undefined);
	const because = reason === undefined ? "" : ` (${reason})`;
	const target =
		err.method !== undefined && err.url !== undefined ? ` on ${err.method} ${err.url}` : "";
	return `${err.message}${because}${target}`;
}

function applyCauseDetail(cause: ApplyError): string {
	switch (cause.kind) {
		case "driverFailure": {
			if (cause.cause instanceof PermissionError) {
				return permissionDetail(cause.cause);
			}

			return describeDriverCause(cause.cause);
		}
		case "unexpectedThrow": {
			return `unexpected error: ${safeStringify(cause.cause)}`;
		}
		case "updateUnsupported": {
			return "update not supported";
		}
	}
}

function buildDesiredDetail(cause: BuildDesiredError): string {
	switch (cause.kind) {
		case "fileReadFailed": {
			return `for '${cause.key}' (${cause.filePath}): ${cause.reason}`;
		}
		case "iconRemovalRejected": {
			return `for '${cause.key}': ${cause.message}`;
		}
		case "redactedNameCollision": {
			const [first, second] = cause.keys;
			return `for '${first}' and '${second}': ${cause.message}`;
		}
	}
}

function configErrorDetail(err: ConfigError): string {
	switch (err.kind) {
		case "configFunctionFailed": {
			return `${err.sourceFile}: config function threw: ${err.message}`;
		}
		case "fileNotFound": {
			return `no bedrock config under ${err.searchedFrom}`;
		}
		case "luauRuntimeMissing": {
			return `${err.sourceFile}: ${err.hint}`;
		}
		case "parseFailed": {
			return `${err.sourceFile}: ${err.message}`;
		}
		case "validationFailed": {
			const first = err.issues[0];
			return first === undefined
				? `${err.sourceFile}: invalid`
				: `${err.sourceFile}: ${first.path.join(".")} ${first.message}`;
		}
	}
}

function stateErrorDetail(cause: StateError): string {
	return `(${cause.file}): ${cause.reason}`;
}

function codegenErrorDetail(cause: CodegenError): string {
	switch (cause.kind) {
		case "codegenEmitThrew": {
			return `because the emitter threw: ${cause.reason}`;
		}
		case "codegenStateReadFailed": {
			return `reading environment '${cause.environment}' ${stateErrorDetail(cause.cause)}`;
		}
		case "codegenWriteFailed": {
			return `writing '${cause.cause.path}': ${cause.cause.reason}`;
		}
	}
}

/* eslint-disable-next-line max-lines-per-function -- single exhaustive switch over every DeployError variant is clearer than splitting into a wrapped-vs-unwrapped predicate plus a parallel prefix table. */
function deployErrorMessage(err: Exclude<DeployError, { kind: "applyFailed" }>): string {
	switch (err.kind) {
		case "buildDesiredFailed": {
			return `build desired state failed ${buildDesiredDetail(err.cause)}`;
		}
		case "codegenFailed": {
			return `codegen failed ${codegenErrorDetail(err.cause)}`;
		}
		case "codegenOutputMissing": {
			return "codegen is enabled but has no output: set codegen.output in your config or pass a codegenWriter to deploy()";
		}
		case "configLoadFailed": {
			return `config load failed: ${configErrorDetail(err.cause)}`;
		}
		case "incompletePassEntry": {
			return `pass '${err.key}' is missing '${err.missingField}' under environment '${err.environment}'`;
		}
		case "incompletePlaceEntry": {
			return `place '${err.key}' is missing '${err.missingField}' under environment '${err.environment}'`;
		}
		case "incompleteUniverseEntry": {
			return `universe is missing '${err.missingField}' under environment '${err.environment}'`;
		}
		case "missingCredential": {
			return `missing credential: environment variable ${err.variable} is not set`;
		}
		case "pendingRebuildWithoutHook": {
			return `place(s) ${err.keys.join(", ")} owe a rebuild but no rebuild hook is available: supply one (or set clearPendingRebuild to abandon two-phase) through a .bedrock/deploy.ts override`;
		}
		case "rebuildHookThrew": {
			return `the rebuild hook threw: ${err.reason}`;
		}
		case "registryConfigMissing": {
			return `registry config missing '${err.missing}' (${err.hint})`;
		}
		case "stateNotConfigured": {
			return `state not configured for environment '${err.environment}'`;
		}
		case "stateReadFailed": {
			return `state read failed ${stateErrorDetail(err.cause)}`;
		}
		case "stateWriteFailed": {
			return `state write failed ${stateErrorDetail(err.cause)}`;
		}
		case "unknownEnvironment": {
			return `unknown environment '${err.environment}' (declared: ${err.declared.join(", ")})`;
		}
		case "unsupportedBackend": {
			return `unsupported state backend '${err.backend}' (${err.hint})`;
		}
	}
}

function parseErrorMessage(err: ParseOptionsError): string {
	switch (err.kind) {
		case "invalidValue": {
			return `invalid value for flag '--${err.flag}' (expected a string)`;
		}
		case "missingRequired": {
			return `missing required flag --${err.flag}`;
		}
		case "unknownFlag": {
			return `unknown flag '--${err.flag}'`;
		}
	}
}

function overrideErrorMessage(input: OverrideErrorRender): string {
	const { environment, err } = input;
	if (err.kind === "launchFailed") {
		return `${environment}: failed to launch override - ${err.cause.message}`;
	}

	return `${environment}: override exited with code ${String(err.exitCode)}`;
}

function migrateParseErrorMessage(err: ParseMigrateError): string {
	if (err.kind === "unknownSource") {
		return `unknown migration source '${err.received}' (supported: ${err.supported.join(", ")})`;
	}

	return parseErrorMessage(err);
}

function migrateErrorMessage(err: MigrateError): string {
	switch (err.kind) {
		case "internalError": {
			return `migrate internal error: ${err.reason} (${configErrorDetail(err.cause)})`;
		}
		case "primaryEnvironmentNotFound": {
			return `primary environment '${err.primary}' not found (available: ${err.available.join(", ")})`;
		}
		case "primaryEnvironmentRequired": {
			return `primary environment required (available: ${err.available.join(", ")})`;
		}
		case "stateFileNotFound": {
			return `Mantle state file not found at '${err.path}'`;
		}
		case "stateParseFailed": {
			return `Mantle state file at '${err.path}' could not be parsed: ${err.reason}`;
		}
		case "unsupportedMantleStateVersion": {
			return `unsupported Mantle state version '${err.found}' (supported: ${err.supported.join(", ")})`;
		}
	}
}

function buildStatePortErrorMessage(err: MissingCredentialError | UnsupportedBackendError): string {
	switch (err.kind) {
		case "missingCredential": {
			return `missing credential: environment variable ${err.variable} is not set`;
		}
		case "unsupportedBackend": {
			return `unsupported state backend '${err.backend}' (${err.hint})`;
		}
	}
}
