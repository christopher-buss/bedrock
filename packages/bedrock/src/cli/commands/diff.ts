import process from "node:process";

import type { CreateOperation, Operation, UpdateOperation } from "../../core/operations.ts";
import type { PluginRegistry } from "../../core/plugin-registry.ts";
import type { RedactionAnnotation } from "../../core/redact-resources.ts";
import type { Config } from "../../core/schema.ts";
import { loadProjectAsync as defaultLoadProject } from "../../shell/load-config.ts";
import {
	previewDiffAsync as defaultPreviewDiff,
	type DiffPreview,
} from "../../shell/preview-diff.ts";
import { createClackPort } from "../clack-port.ts";
import { buildEnvironmentReader } from "../credential-environment-overrides.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import { type ClackPort, renderDeployError } from "../render.ts";
import { startCommandAsync } from "./start-command.ts";

interface ResolvedDiff {
	readonly clack: ClackPort;
	readonly exit: (code: number) => void;
	readonly loadProject: typeof defaultLoadProject;
	readonly previewDiff: typeof defaultPreviewDiff;
}

interface DispatchInputs {
	readonly config: Config;
	readonly environments: ReadonlyArray<string>;
	readonly getEnv: (name: string) => string | undefined;
	readonly plugins: PluginRegistry;
	readonly resolved: ResolvedDiff;
}

interface DispatchOutcome {
	readonly failed: ReadonlyArray<string>;
	readonly hasDrift: boolean;
}

/**
 * Build the sade action for `bedrock diff`. The returned function consumes
 * the raw options object sade hands the action callback, parses it via
 * `parseCommonOptions`, loads the project config once, and dispatches
 * `previewDiff()` for each `--env` value in order. Per-env successes render
 * the operations list (or a `No drift` line when every op is a noop);
 * failures render via `renderDeployError`. The aggregated exit code is
 * `EXIT_OK` only when every env succeeded.
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function diffCommand(
	deps: ProgDependencies,
): (rawOptions: Record<string, unknown>) => Promise<void> {
	const resolved = resolveDiff(deps);
	return async (rawOptions) => {
		const code = await runDiffAsync(rawOptions, resolved);
		resolved.exit(code);
	};
}

function resolveDiff(dependencies: ProgDependencies): ResolvedDiff {
	return {
		clack: dependencies.clack ?? createClackPort(),
		exit: dependencies.exit ?? ((code: number) => process.exit(code)),
		loadProject: dependencies.loadProject ?? defaultLoadProject,
		previewDiff: dependencies.previewDiff ?? defaultPreviewDiff,
	};
}

function cancelAsFailed(clack: ClackPort): void {
	clack.cancel("diff failed");
}

function describeOp(op: CreateOperation | UpdateOperation): string {
	switch (op.type) {
		case "create": {
			return `+ ${op.desired.kind}:${op.key}`;
		}
		case "update": {
			return `~ ${op.desired.kind}:${op.key} ${op.changedFields.join(" + ")} updated`;
		}
	}
}

function isDriftOp(op: Operation): op is CreateOperation | UpdateOperation {
	return op.type !== "noop";
}

function describeRedaction(redaction: RedactionAnnotation): string {
	const suffix = redaction.hasRealValueEdits ? "redacted, real values not pushed" : "redacted";
	return `- ${redaction.kind}:${redaction.key} (${suffix})`;
}

function renderRedactions(preview: DiffPreview, clack: ClackPort): void {
	const driftPairs = new Set(
		preview.ops.filter(isDriftOp).map((op) => `${op.desired.kind}:${op.key}`),
	);
	const redactedNoops = preview.redactions.filter(
		(redaction) => !driftPairs.has(`${redaction.kind}:${redaction.key}`),
	);
	if (redactedNoops.length === 0) {
		return;
	}

	clack.logMessage(`Redacted in "${preview.environment}":`);
	for (const redaction of redactedNoops) {
		clack.logMessage(describeRedaction(redaction));
	}
}

function renderPendingRebuild(preview: DiffPreview, clack: ClackPort): boolean {
	// A persistent marker is "minted but unpublished" drift: assets were
	// provisioned but the place artifact never published. It self-heals on the
	// next green publish, so it is reported rather than failing the diff.
	if (preview.pendingRebuild.length === 0) {
		return false;
	}

	const keys = preview.pendingRebuild.join(", ");
	clack.logMessage(
		`${preview.pendingRebuild.length} place(s) minted but unpublished in "${preview.environment}": ${keys}`,
	);
	return true;
}

function renderPreview(preview: DiffPreview, clack: ClackPort): boolean {
	const drift = preview.ops.filter(isDriftOp);
	if (drift.length === 0) {
		const hasPendingPublish = renderPendingRebuild(preview, clack);
		if (!hasPendingPublish) {
			clack.logSuccess(`No drift for "${preview.environment}"`);
		}

		renderRedactions(preview, clack);
		return hasPendingPublish;
	}

	clack.logMessage(`Pending changes for "${preview.environment}":`);
	for (const op of drift) {
		clack.logMessage(describeOp(op));
	}

	renderPendingRebuild(preview, clack);
	renderRedactions(preview, clack);

	return true;
}

async function dispatchEnvironmentsAsync({
	config,
	environments,
	getEnv,
	plugins,
	resolved,
}: DispatchInputs): Promise<DispatchOutcome> {
	const failed: Array<string> = [];
	let hasDrift = false;
	for (const environment of environments) {
		const result = await resolved.previewDiff({
			config,
			environment,
			getEnv,
			plugins,
		});
		if (result.success) {
			if (renderPreview(result.data, resolved.clack)) {
				hasDrift = true;
			}
		} else {
			renderDeployError(result.err, resolved.clack);
			failed.push(environment);
		}
	}

	return { failed, hasDrift };
}

function outroFor(hasDrift: boolean): string {
	return hasDrift
		? "run bedrock deploy to apply pending changes"
		: "all environments are up to date";
}

async function runDiffAsync(
	rawOptions: Record<string, unknown>,
	resolved: ResolvedDiff,
): Promise<number> {
	const started = await startCommandAsync(
		{ clack: resolved.clack, command: "diff", loadProject: resolved.loadProject },
		rawOptions,
	);
	if (!started.success) {
		return EXIT_ERROR;
	}

	const { loaded, parsed } = started.data;
	const outcome = await dispatchEnvironmentsAsync({
		config: loaded.config,
		environments: parsed.environments,
		getEnv: buildEnvironmentReader(parsed),
		plugins: loaded.plugins,
		resolved,
	});
	if (outcome.failed.length > 0) {
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	resolved.clack.outro(outroFor(outcome.hasDrift));
	return EXIT_OK;
}
