import { createClackPort } from "../cli/clack-port.ts";
import { declarationReportLine } from "../cli/declaration-report.ts";
import { deferredCreatesLine } from "../cli/deferred-creates.ts";
import { applyCauseDetail } from "../cli/failure-detail.ts";
import {
	type ClackPort,
	renderDeployError,
	type RenderPort,
	renderVerbose,
	withVerbosity,
} from "../cli/render.ts";
import { resolveStateConfig } from "../core/resolve-state-config.ts";
import {
	type Config,
	isGistStateConfig,
	type ResolvedConfig,
	type StateConfig,
} from "../core/schema.ts";
import type {
	BadgeCreatesDeferredEvent,
	DeclarationReportEvent,
	ProgressEvent,
	ProgressPort,
	ResourceOpSucceededCreateEvent,
} from "../ports/progress-port.ts";

/**
 * Configuration for {@link createClackProgressAdapter}.
 *
 * @since 0.1.0
 */
export interface ClackProgressAdapterDeps {
	/**
	 * Output port the events are rendered through. Its `verbose` follows each
	 * failed resource line with its earlier retry attempts, stacks, and cause
	 * chain.
	 */
	readonly clack: RenderPort;
	/**
	 * Loaded project config (raw `Config` or env-resolved `ResolvedConfig`);
	 * the `stateWritten` case resolves the per-environment `StateConfig`
	 * against this to format the backend label. When omitted, `stateWritten`
	 * renders the generic `"state"` placeholder.
	 */
	readonly config?: Config | ResolvedConfig;
}

/**
 * Build a {@link ProgressPort} that renders events through a `ClackPort`.
 * Pattern-matches on the event `kind`: per-resource events render one line
 * each, the aggregate `applySummary` becomes the deploy footer, and
 * `stateWritten` names the persistence backend resolved from the loaded
 * `Config`.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { createClackProgressAdapter, type ClackPort } from "@bedrock-rbx/core";
 *
 * const lines: Array<string> = [];
 * const clack: ClackPort = {
 *     cancel: (message) => lines.push(`cancel: ${message}`),
 *     intro: (message) => lines.push(`intro: ${message}`),
 *     logError: (message) => lines.push(`error: ${message}`),
 *     logMessage: (message) => lines.push(`log: ${message}`),
 *     logSuccess: (message) => lines.push(`ok: ${message}`),
 *     outro: (message) => lines.push(`outro: ${message}`),
 * };
 *
 * const port = createClackProgressAdapter({ clack });
 *
 * port.emit({ environment: "production", kind: "stateWritten" });
 *
 * expect(lines).toEqual(["log: State written to state"]);
 * ```
 *
 * @param deps - The clack port and optional config the adapter renders through.
 * @returns A `ProgressPort` that renders via clack.
 */
export function createClackProgressAdapter(deps: ClackProgressAdapterDeps): ProgressPort {
	return {
		emit(event: ProgressEvent): void {
			renderEvent(event, deps);
		},
	};
}

/**
 * Build a {@link ProgressPort} for the default CLI rendering path: wires a
 * fresh {@link createClackPort} into {@link createClackProgressAdapter}. The
 * `config` argument (raw `Config` or env-resolved `ResolvedConfig`) is
 * forwarded so `stateWritten` events can name the persistence backend; pass
 * `undefined` when the config has not yet loaded.
 *
 * Internal: used by `deploy()`'s default-port resolver when callers omit
 * `progress` and `BEDROCK_CLI` is set.
 *
 * @param config - Pre-loaded or env-resolved config used to format the
 *   state-backend label, or `undefined` to render the generic placeholder.
 * @param verbose - Whether each failure line is followed by its verbose
 *   diagnostics.
 * @returns A clack-backed `ProgressPort` that writes to `process.stdout`.
 */
export function createDefaultProgressAdapter(
	config: Config | ResolvedConfig | undefined,
	verbose: boolean,
): ProgressPort {
	const clack = withVerbosity(createClackPort(), verbose);
	return config === undefined
		? createClackProgressAdapter({ clack })
		: createClackProgressAdapter({ clack, config });
}

function applySummaryLine(
	event: Extract<ProgressEvent, { kind: "applySummary" }>,
	failed: boolean,
): string {
	const seconds = (event.durationMs / 1000).toFixed(1);
	const parts = [
		`${event.created} create`,
		`${event.updated} update`,
		...(event.retired === 0 ? [] : [`${event.retired} retire`]),
		...(event.untracked === 0 ? [] : [`${event.untracked} untrack`]),
		`${event.noop} noop`,
		`${event.failed} failed`,
	];
	const outcome = failed ? "Failed" : "Succeeded";
	return `${outcome} in ${seconds}s: ${parts.join(", ")}`;
}

/**
 * Name the **Backend** one environment's state lives in, for a line that
 * reports where a snapshot was written.
 *
 * @param state - The resolved `state` block.
 * @returns The label to log.
 */
function stateConfigLabel(state: StateConfig): string {
	if (isGistStateConfig(state)) {
		return `gist:${state.gistId}`;
	}

	return state.backend;
}

/**
 * Name where one environment's state was written, falling back to a bare
 * label when the config names no **Backend** for it.
 *
 * @param config - The project config, when the adapter was given one.
 * @param environment - Environment whose state was written.
 * @returns The label to log.
 */
function formatStateLabel(
	config: Config | ResolvedConfig | undefined,
	environment: string,
): string {
	if (config === undefined) {
		return "state";
	}

	const resolved = resolveStateConfig(config, environment);
	if (!resolved.success) {
		return "state";
	}

	return stateConfigLabel(resolved.data);
}

function renderDeployEvent(
	event: Extract<
		ProgressEvent,
		{
			kind: "applySummary" | "deployFailure" | "deploySuccess" | "stateWritten";
		}
	>,
	{ clack, config }: ClackProgressAdapterDeps,
): void {
	switch (event.kind) {
		case "applySummary": {
			const failed = event.failed > 0;
			const line = applySummaryLine(event, failed);
			if (failed) {
				clack.logError(line);
			} else {
				clack.logMessage(line);
			}

			return;
		}
		case "deployFailure": {
			// Each failed resource printed its diagnostics on its own line.
			const port = event.error.kind === "applyFailed" ? withVerbosity(clack, false) : clack;
			renderDeployError(event.error, port);
			return;
		}
		case "deploySuccess": {
			clack.logSuccess(`${event.environment}: ${event.resourceCount} resources reconciled`);
			return;
		}
		case "stateWritten": {
			clack.logMessage(`State written to ${formatStateLabel(config, event.environment)}`);
		}
	}
}

/**
 * Render one backoff while another run holds the environment, naming the
 * holder when the **Backend** could read it and how long acquisition will
 * keep waiting.
 *
 * @param event - The wait as the **Backend** reported it.
 * @returns The line to log.
 */
function stateLockWaitingLine(event: Extract<ProgressEvent, { kind: "stateLockWaiting" }>): string {
	const holder = event.holder === undefined ? "" : `, held by ${event.holder}`;
	const seconds = (event.remainingMs / 1000).toFixed(1);
	return `Waiting for the ${event.environment} state lock${holder}: ${seconds}s left`;
}

/**
 * Render a deploy running without a hold because the config turned locking
 * off, so the guarantee that is not in force is on screen.
 *
 * @param event - The environment being deployed without a hold.
 * @returns The line to log.
 */
function stateLockDisabledLine(
	event: Extract<ProgressEvent, { kind: "stateLockDisabled" }>,
): string {
	return `Locking is off for ${event.environment} by config: concurrent deploys are not held apart`;
}

/**
 * Render one event about the hold a **Deploy** runs under.
 *
 * @param event - The lock event to render.
 * @param clack - Where the line is written.
 */
function renderStateLockEvent(
	event: Extract<
		ProgressEvent,
		{
			kind:
				| "stateLockDisabled"
				| "stateLockLeaseLost"
				| "stateLockReleaseFailed"
				| "stateLockWaiting";
		}
	>,
	clack: ClackPort,
): void {
	switch (event.kind) {
		case "stateLockDisabled": {
			clack.logMessage(stateLockDisabledLine(event));
			return;
		}
		case "stateLockLeaseLost": {
			clack.logError(`Lost the ${event.environment} state lock: ${event.error.reason}`);
			return;
		}
		case "stateLockReleaseFailed": {
			clack.logMessage(
				`Warning: could not release the ${event.environment} state lock: ${event.error.reason}. A later run may wait for expiry or need explicit recovery with bedrock state unlock --env ${event.environment}.`,
			);
			return;
		}
		case "stateLockWaiting": {
			clack.logMessage(stateLockWaitingLine(event));
		}
	}
}

function extractResourceId(event: ResourceOpSucceededCreateEvent): string | undefined {
	switch (event.resourceKind) {
		case "badge": {
			return event.outputs.badgeId;
		}
		case "developerProduct": {
			return event.outputs.productId;
		}
		case "gamePass": {
			return event.outputs.assetId;
		}
		case "place": {
			return undefined;
		}
		case "universe": {
			return event.outputs.rootPlaceId;
		}
	}
}

function renderResourceOpSucceeded(
	event: Extract<ProgressEvent, { kind: "resourceOpSucceeded" }>,
	clack: ClackPort,
): void {
	if (event.opType === "create") {
		const id = extractResourceId(event);
		const suffix = id === undefined ? "" : ` (id ${id})`;
		clack.logSuccess(`${event.resourceKind}.${event.key} created${suffix}`);
		return;
	}

	if (event.opType === "retire") {
		clack.logSuccess(
			`${event.resourceKind}.${event.key} ${event.name} (id ${event.robloxId}) retired`,
		);
		return;
	}

	if (event.opType === "untrack") {
		clack.logSuccess(
			`${event.resourceKind}.${event.key} ${event.name} (id ${event.robloxId}) untracked`,
		);
		return;
	}

	clack.logSuccess(
		`${event.resourceKind}.${event.key} ${event.changedFields.join(", ")} updated`,
	);
}

function renderResourceOpEvent(
	event: Extract<
		ProgressEvent,
		{
			kind:
				| "resourceOpFailed"
				| "resourceOpNoop"
				| "resourceOpStarted"
				| "resourceOpSucceeded";
		}
	>,
	{ clack }: ClackProgressAdapterDeps,
): void {
	switch (event.kind) {
		case "resourceOpFailed": {
			const identity =
				event.opType === "retire" ? ` ${event.name} (id ${event.robloxId})` : "";
			clack.logError(
				`${event.resourceKind}.${event.key}${identity} failed: ${applyCauseDetail(event.error)}`,
			);
			renderVerbose(event.error, clack);
			return;
		}
		case "resourceOpNoop": {
			clack.logMessage(`${event.resourceKind}.${event.key} unchanged`);
			return;
		}
		case "resourceOpStarted": {
			return;
		}
		case "resourceOpSucceeded": {
			renderResourceOpSucceeded(event, clack);
		}
	}
}

function reportLine(event: BadgeCreatesDeferredEvent | DeclarationReportEvent): string {
	return event.kind === "badgeCreatesDeferred"
		? deferredCreatesLine(event)
		: declarationReportLine(event.report);
}

function renderEvent(event: ProgressEvent, dependencies: ClackProgressAdapterDeps): void {
	switch (event.kind) {
		case "applySummary":
		case "deployFailure":
		case "deploySuccess":
		case "stateWritten": {
			renderDeployEvent(event, dependencies);
			return;
		}
		case "badgeCreatesDeferred":
		case "declarationReport": {
			dependencies.clack.logMessage(reportLine(event));
			return;
		}
		case "stateLockDisabled":
		case "stateLockLeaseLost":
		case "stateLockReleaseFailed":
		case "stateLockWaiting": {
			renderStateLockEvent(event, dependencies.clack);
			return;
		}
		case "resourceOpFailed":
		case "resourceOpNoop":
		case "resourceOpStarted":
		case "resourceOpSucceeded": {
			renderResourceOpEvent(event, dependencies);
		}
	}
}
