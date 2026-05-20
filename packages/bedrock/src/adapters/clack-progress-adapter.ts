import { createClackPort } from "../cli/clack-port.ts";
import { type ClackPort, renderDeployError } from "../cli/render.ts";
import { resolveStateConfig } from "../core/resolve-state-config.ts";
import { type Config, isGistStateConfig, type StateConfig } from "../core/schema.ts";
import type {
	ProgressEvent,
	ProgressPort,
	ResourceOpSucceededCreateEvent,
} from "../ports/progress-port.ts";
import type { ApplyError } from "../shell/apply-ops.ts";

/**
 * Configuration for {@link createClackProgressAdapter}.
 */
export interface ClackProgressAdapterDeps {
	/** Output port the events are rendered through. */
	readonly clack: ClackPort;
	/**
	 * Loaded project config; the `stateWritten` case resolves the per-environment
	 * `StateConfig` against this to format the backend label. When omitted,
	 * `stateWritten` renders the generic `"state"` placeholder.
	 */
	readonly config?: Config;
}

/**
 * Build a {@link ProgressPort} that renders events through a `ClackPort`.
 * Pattern-matches on the event `kind`: per-resource events render one line each,
 * the aggregate `applySummary` becomes the deploy footer, and `stateWritten`
 * names the persistence backend resolved from the loaded `Config`.
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
 * `config` argument is forwarded so `stateWritten` events can name the
 * persistence backend; pass `undefined` when the config has not yet loaded.
 *
 * Internal: used by `deploy()`'s default-port resolver when callers omit
 * `progress` and `BEDROCK_CLI` is set.
 *
 * @param config - Pre-loaded config used to format the state-backend label,
 *   or `undefined` to render the generic placeholder.
 * @returns A clack-backed `ProgressPort` that writes to `process.stdout`.
 */
export function createDefaultProgressAdapter(config: Config | undefined): ProgressPort {
	const clack = createClackPort();
	return config === undefined
		? createClackProgressAdapter({ clack })
		: createClackProgressAdapter({ clack, config });
}

function applySummaryLine(event: Extract<ProgressEvent, { kind: "applySummary" }>): string {
	const seconds = (event.durationMs / 1000).toFixed(1);
	const parts = [
		`${event.created} create`,
		`${event.updated} update`,
		`${event.noop} noop`,
		`${event.failed} failed`,
	];
	return `Succeeded in ${seconds}s: ${parts.join(", ")}`;
}

function stateConfigLabel(state: StateConfig): string {
	if (isGistStateConfig(state)) {
		return `gist:${state.gistId}`;
	}

	return state.backend;
}

function formatStateLabel(config: Config | undefined, environment: string): string {
	if (config === undefined) {
		return "state";
	}

	const resolved = resolveStateConfig(config, environment);
	if (!resolved.success) {
		return "state";
	}

	return stateConfigLabel(resolved.data);
}

function extractResourceId(event: ResourceOpSucceededCreateEvent): string | undefined {
	switch (event.resourceKind) {
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

	clack.logSuccess(
		`${event.resourceKind}.${event.key} ${event.changedFields.join(", ")} updated`,
	);
}

function describeApplyError(error: ApplyError): string {
	switch (error.kind) {
		case "driverFailure": {
			return `failed: ${error.cause.message}`;
		}
		case "unexpectedThrow": {
			return "unexpected error";
		}
		case "updateUnsupported": {
			return "update not supported";
		}
	}
}

/* eslint-disable-next-line max-lines-per-function -- single exhaustive switch over every ProgressEvent variant is clearer than splitting into deploy-level vs per-resource halves, which would leave both halves non-exhaustive and required a boolean handoff that hides the dispatch surface. */
function renderEvent(event: ProgressEvent, deps: ClackProgressAdapterDeps): void {
	const { clack, config } = deps;
	switch (event.kind) {
		case "applySummary": {
			clack.logMessage(applySummaryLine(event));
			return;
		}
		case "deployFailure": {
			renderDeployError(event.error, clack);
			return;
		}
		case "deploySuccess": {
			clack.logSuccess(`${event.environment}: ${event.resourceCount} resources reconciled`);
			return;
		}
		case "resourceOpFailed": {
			clack.logError(`${event.resourceKind}.${event.key} ${describeApplyError(event.error)}`);
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
			return;
		}
		case "stateWritten": {
			clack.logMessage(`State written to ${formatStateLabel(config, event.environment)}`);
		}
	}
}
