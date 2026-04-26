import process from "node:process";

import type { CreateOperation, Operation, UpdateOperation } from "../../core/operations.ts";
import type { Config } from "../../core/schema.ts";
import {
	loadConfig as defaultLoadConfig,
	type LoadConfigOptions,
} from "../../shell/load-config.ts";
import { previewDiff as defaultPreviewDiff, type DiffPreview } from "../../shell/preview-diff.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps } from "../index.ts";
import { type CommonOptions, parseCommonOptions } from "../parse-options.ts";
import { type ClackPort, createClackPort, renderDeployError, renderParseError } from "../render.ts";

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
	return (name) => {
		if (name === "ROBLOX_API_KEY" && parsed.apiKey !== undefined) {
			return parsed.apiKey;
		}

		if (name === "GITHUB_TOKEN" && parsed.githubToken !== undefined) {
			return parsed.githubToken;
		}

		return process.env[name];
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
			return `~ ${op.desired.kind}:${op.key}`;
		}
	}
}

function isDriftOp(op: Operation): op is CreateOperation | UpdateOperation {
	return op.type !== "noop";
}

function renderPreview(preview: DiffPreview, clack: ClackPort): void {
	const drift = preview.ops.filter(isDriftOp);
	if (drift.length === 0) {
		clack.logSuccess(`No drift for "${preview.environment}"`);
		return;
	}

	clack.logMessage(`Pending changes for "${preview.environment}":`);
	for (const op of drift) {
		clack.logMessage(describeOp(op));
	}
}

async function dispatchEnvironments(inputs: DispatchInputs): Promise<ReadonlyArray<string>> {
	const { config, environments, getEnv, resolved } = inputs;
	const failed: Array<string> = [];
	for (const environment of environments) {
		const result = await resolved.previewDiff({
			config,
			environment,
			getEnv,
		});
		if (result.success) {
			renderPreview(result.data, resolved.clack);
		} else {
			renderDeployError(result.err, resolved.clack);
			failed.push(environment);
		}
	}

	return failed;
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

	const failures = await dispatchEnvironments({
		config: loaded.data,
		environments: parsed.data.environments,
		getEnv: buildGetEnvironment(parsed.data),
		resolved,
	});
	if (failures.length > 0) {
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	resolved.clack.outro("run bedrock deploy to apply pending changes");
	return EXIT_OK;
}
