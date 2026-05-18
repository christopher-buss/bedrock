import process from "node:process";

import type { CreateOperation, Operation, UpdateOperation } from "../../core/operations.ts";
import type { RedactionAnnotation } from "../../core/redact-resources.ts";
import type { Config } from "../../core/schema.ts";
import {
	loadConfig as defaultLoadConfig,
	type LoadConfigOptions,
} from "../../shell/load-config.ts";
import { previewDiff as defaultPreviewDiff, type DiffPreview } from "../../shell/preview-diff.ts";
import { createClackPort } from "../clack-port.ts";
import { buildCredentialOverrides } from "../credential-environment-overrides.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps } from "../index.ts";
import { type CommonOptions, parseCommonOptions } from "../parse-options.ts";
import { type ClackPort, renderDeployError, renderParseError } from "../render.ts";

interface ResolvedDiff {
	readonly clack: ClackPort;
	readonly exit: (code: number) => void;
	readonly loadConfig: typeof defaultLoadConfig;
	readonly previewDiff: typeof defaultPreviewDiff;
}

interface DispatchInputs {
	readonly config: Config;
	readonly environments: ReadonlyArray<string>;
	readonly getEnv: (name: string) => string | undefined;
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
	deps: ProgDeps,
): (rawOptions: Record<string, unknown>) => Promise<void> {
	const resolved = resolveDiff(deps);
	return async (rawOptions) => {
		const code = await runDiff(rawOptions, resolved);
		resolved.exit(code);
	};
}

function resolveDiff(deps: ProgDeps): ResolvedDiff {
	return {
		clack: deps.clack ?? createClackPort(),
		exit: deps.exit ?? ((code: number) => process.exit(code)),
		loadConfig: deps.loadConfig ?? defaultLoadConfig,
		previewDiff: deps.previewDiff ?? defaultPreviewDiff,
	};
}

function loadOptionsFor(parsed: CommonOptions): LoadConfigOptions | undefined {
	return parsed.configFile === undefined ? undefined : { configFile: parsed.configFile };
}

function buildGetEnvironment(parsed: CommonOptions): (name: string) => string | undefined {
	const overrides = buildCredentialOverrides(parsed);
	return (name) => overrides[name] ?? process.env[name];
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

function renderPreview(preview: DiffPreview, clack: ClackPort): boolean {
	const drift = preview.ops.filter(isDriftOp);
	if (drift.length === 0) {
		clack.logSuccess(`No drift for "${preview.environment}"`);
		renderRedactions(preview, clack);
		return false;
	}

	clack.logMessage(`Pending changes for "${preview.environment}":`);
	for (const op of drift) {
		clack.logMessage(describeOp(op));
	}

	renderRedactions(preview, clack);

	return true;
}

async function dispatchEnvironments(inputs: DispatchInputs): Promise<DispatchOutcome> {
	const { config, environments, getEnv, resolved } = inputs;
	const failed: Array<string> = [];
	let hasDrift = false;
	for (const environment of environments) {
		const result = await resolved.previewDiff({
			config,
			environment,
			getEnv,
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

async function runDiff(
	rawOptions: Record<string, unknown>,
	resolved: ResolvedDiff,
): Promise<number> {
	resolved.clack.intro("bedrock diff");

	const parsed = parseCommonOptions(rawOptions);
	if (!parsed.success) {
		renderParseError(parsed.err, resolved.clack);
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	const loaded = await resolved.loadConfig(loadOptionsFor(parsed.data));
	if (!loaded.success) {
		renderDeployError({ cause: loaded.err, kind: "configLoadFailed" }, resolved.clack);
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	const outcome = await dispatchEnvironments({
		config: loaded.data,
		environments: parsed.data.environments,
		getEnv: buildGetEnvironment(parsed.data),
		resolved,
	});
	if (outcome.failed.length > 0) {
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	resolved.clack.outro(outroFor(outcome.hasDrift));
	return EXIT_OK;
}
