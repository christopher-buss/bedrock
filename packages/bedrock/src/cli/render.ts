import { PermissionError } from "@bedrock-rbx/ocale";

import type { ConfigError } from "../core/config-error.ts";
import type { MigrateError, MigrationSummary } from "../core/migrate/migration-report.ts";
import type { StateError } from "../core/state.ts";
import type { ApplyError } from "../shell/apply-ops.ts";
import type { BuildDesiredError } from "../shell/build-desired.ts";
import type { MissingCredentialError, UnsupportedBackendError } from "../shell/build-state-port.ts";
import type { DeployError } from "../shell/deploy.ts";
import type { ParseMigrateError } from "./parse-migrate-options.ts";
import type { ParseOptionsError } from "./parse-options.ts";

/**
 * Output port the CLI renders through. Mirrors the subset of `@clack/prompts`
 * the bedrock CLI uses today; tests inject a fake to assert what was rendered.
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

/**
 * Render a `DeployError` to the supplied `ClackPort`. Most variants emit a
 * single error line; `applyFailed` emits one line per failing op in the
 * aggregate (in Phase 1 then Phase 2 input order). Wrapped variants
 * (`applyFailed`, `buildDesiredFailed`, `configLoadFailed`,
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

function permissionDetail(err: PermissionError): string {
	const isPlural = err.requiredScopes.length > 1;
	const label = isPlural ? "scopes" : "scope";
	const pronoun = isPlural ? "them" : "it";
	const scopeList = err.requiredScopes.map((scope) => `'${scope}'`).join(", ");
	return `${err.message} on ${err.operationKey}: missing required ${label} ${scopeList}. Grant ${pronoun} on the API key at https://create.roblox.com/credentials`;
}

/**
 * Coerce an arbitrary thrown value to a display string without ever throwing.
 * `String(value)` itself can throw on null-prototype objects or values whose
 * `toString`/`Symbol.toPrimitive` implementations reject coercion; the
 * renderer's contract is to surface the failure, not crash mid-diagnostic.
 * @param value - The thrown value to render.
 * @returns The `message` of an `Error`, the `String()` coercion for other
 *   values, or `"<unprintable cause>"` when even `String()` throws.
 */
function safeStringify(value: unknown): string {
	if (value instanceof Error) {
		return value.message;
	}

	try {
		return String(value);
	} catch {
		return "<unprintable cause>";
	}
}

function applyCauseDetail(cause: ApplyError): string {
	switch (cause.kind) {
		case "driverFailure": {
			if (cause.cause instanceof PermissionError) {
				return permissionDetail(cause.cause);
			}

			return cause.cause.message;
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
			return `(${cause.filePath}): ${cause.reason}`;
		}
		case "iconRemovalRejected": {
			return `: ${cause.message}`;
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

/* eslint-disable-next-line max-lines-per-function -- single exhaustive switch over every DeployError variant is clearer than splitting into a wrapped-vs-unwrapped predicate plus a parallel prefix table. */
function deployErrorMessage(err: Exclude<DeployError, { kind: "applyFailed" }>): string {
	switch (err.kind) {
		case "buildDesiredFailed": {
			return `build desired state failed for '${err.cause.key}' ${buildDesiredDetail(err.cause)}`;
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
