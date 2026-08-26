import { safeStringify } from "../core/error-chain.ts";
import type { MigrateError, MigrationSummary } from "../core/migrate/migration-report.ts";
import type { StateError } from "../core/state.ts";
import type {
	MissingCredentialError,
	PluginStateBackendError,
	UnsupportedBackendError,
} from "../shell/build-state-port.ts";
import type { DeployError } from "../shell/deploy.ts";
import type { OverrideErrorRender } from "./error-messages.ts";
import {
	buildStatePortErrorMessage,
	deployErrorMessage,
	migrateErrorMessage,
	migrateParseErrorMessage,
	overrideErrorMessage,
	parseErrorMessage,
	stateErrorDetail,
} from "./error-messages.ts";
import { applyCauseDetail } from "./failure-detail.ts";
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
	/**
	 * Path to the Markdown report on disk. Pointed at from the action-required
	 * and review-needed lines.
	 */
	readonly reportPath: string;
	/** Aggregate counts from a `MigrationReport`. */
	readonly summary: MigrationSummary;
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
	err: MissingCredentialError | PluginStateBackendError | UnsupportedBackendError,
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
	port.logError(`state write failed for '${input.environment}' ${stateErrorDetail(input.err)}`);
}
