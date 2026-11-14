import process from "node:process";

import { currentResourceIdentity } from "../../core/current-resource-identity.ts";
import type {
	CreateOperation,
	Operation,
	RetireOperation,
	UntrackOperation,
	UpdateOperation,
} from "../../core/operations.ts";
import type { PluginRegistry } from "../../core/plugin-registry.ts";
import type { RedactionAnnotation } from "../../core/redact-resources.ts";
import type { Config } from "../../core/schema.ts";
import { loadProjectAsync as defaultLoadProject } from "../../shell/load-config.ts";
import {
	previewDiffAsync as defaultPreviewDiff,
	type DiffPreview,
} from "../../shell/preview-diff.ts";
import type { LiveCheckOptions } from "../../shell/read-live-state.ts";
import { createClackPort } from "../clack-port.ts";
import { buildEnvironmentReader } from "../credential-environment-overrides.ts";
import { declarationReportLine } from "../declaration-report.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import { renderLiveCheck } from "../live-check-report.ts";
import { liveOptionsFor } from "../live-options.ts";
import { type ClackPort, describeHolder, renderDeployError, type RenderPort } from "../render.ts";
import { spendQuoteCost } from "../spend-quote.ts";
import { unconfirmedCreatesDetail } from "../unconfirmed-paid-creates.ts";
import { startCommandAsync } from "./start-command.ts";

interface ResolvedDiff {
	readonly clack: RenderPort;
	readonly exit: (code: number) => void;
	readonly loadProject: typeof defaultLoadProject;
	readonly previewDiff: typeof defaultPreviewDiff;
}

interface DispatchInputs extends LiveCheckOptions {
	readonly allowSpend: boolean;
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
		exit: dependencies.exit ?? ((code) => process.exit(code)),
		loadProject: dependencies.loadProject ?? defaultLoadProject,
		previewDiff: dependencies.previewDiff ?? defaultPreviewDiff,
	};
}

function cancelAsFailed(clack: ClackPort): void {
	clack.cancel("diff failed");
}

function describeOp(
	op: CreateOperation | RetireOperation | UntrackOperation | UpdateOperation,
	deferred: ReadonlySet<string>,
): string {
	switch (op.type) {
		case "create": {
			const name = op.desired.kind === "badge" ? ` ${op.desired.name}` : "";
			const label = deferred.has(`${op.desired.kind}:${op.key}`)
				? " create (deferred: no free badge quota)"
				: "";
			return `+ ${op.desired.kind}:${op.key}${name}${label}`;
		}
		case "retire":
		case "untrack": {
			const { current } = op;
			const { name, robloxId } = currentResourceIdentity(current);
			return `- ${current.kind}:${op.key} ${name} (id ${robloxId}) ${op.type}`;
		}
		case "update": {
			return `~ ${op.desired.kind}:${op.key} ${op.changedFields.join(" + ")} updated`;
		}
	}
}

function isDriftOp(
	op: Operation,
): op is CreateOperation | RetireOperation | UntrackOperation | UpdateOperation {
	return op.type !== "noop";
}

function describeRedaction(redaction: RedactionAnnotation): string {
	const suffix = redaction.hasRealValueEdits ? "redacted, real values not pushed" : "redacted";
	return `- ${redaction.kind}:${redaction.key} (${suffix})`;
}

function renderRedactions(preview: DiffPreview, clack: ClackPort): void {
	const driftPairs = new Set(
		preview.ops
			.filter(isDriftOp)
			.map((op) => `${"current" in op ? op.current.kind : op.desired.kind}:${op.key}`),
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

/**
 * Report what the **Paid creates** of the previewed Deploy cost, or, without
 * spend approval, what `--allow-spend` would pay for its Deferred creates.
 *
 * @param preview - The preview just computed.
 * @param clack - Where the line is written.
 */
function renderSpendQuote(preview: DiffPreview, clack: ClackPort): void {
	const quote = preview.spendQuote;
	if (quote === undefined || quote.paid === 0) {
		return;
	}

	const cost = spendQuoteCost(quote);
	if (quote.worstCase === true) {
		clack.logMessage(
			`up to ${quote.paid} paid badge creates in "${preview.environment}", the free badge quota is unknown: ${cost}`,
		);
		return;
	}

	if (quote.approved) {
		clack.logMessage(`${quote.paid} paid badge creates in "${preview.environment}": ${cost}`);
		return;
	}

	const deferred = preview.deferredCreates?.length;
	clack.logMessage(
		`--allow-spend pays for ${quote.paid} of the ${deferred} deferred badge creates in "${preview.environment}": ${cost}`,
	);
}

/**
 * Report what the badge creates of the previewed Deploy cost, and the ones
 * an **Unconfirmed paid create** holds back.
 *
 * @param preview - The preview just computed.
 * @param clack - Where the lines are written.
 */
function renderBadgeNotes(preview: DiffPreview, clack: ClackPort): void {
	renderSpendQuote(preview, clack);
	const creates = preview.unconfirmedPaidCreates ?? [];
	if (creates.length > 0) {
		clack.logMessage(
			`badge creates held in "${preview.environment}": ${unconfirmedCreatesDetail(creates)}`,
		);
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

/**
 * Report a deploy holding the **Environment** while the preview ran, which
 * is what says the answer may already be behind. A diff takes no hold, so
 * it never queues behind a deploy and never learns that one landed.
 *
 * @param preview - The preview just computed.
 * @param clack - Where the line is written.
 */
function renderConcurrentHold(preview: DiffPreview, clack: ClackPort): void {
	const { concurrentHold, holdUnknown } = preview;
	if (holdUnknown !== undefined) {
		clack.logMessage(
			`who holds "${preview.environment}" could not be read (${holdUnknown.reason}), so this diff may already be out of date`,
		);
		return;
	}

	if (concurrentHold === undefined) {
		return;
	}

	clack.logMessage(
		`"${preview.environment}" is held by ${describeHolder(concurrentHold)}, so this diff may already be out of date`,
	);
}

/**
 * Report the live items an `importId` records in this run. An import is a
 * pending State change, so it counts as drift.
 *
 * @param preview - The preview just computed.
 * @param clack - Where the lines are written.
 * @returns Whether the preview imports anything.
 */
function renderImports(preview: DiffPreview, clack: ClackPort): boolean {
	const imports = preview.imports ?? [];
	if (imports.length === 0) {
		return false;
	}

	clack.logMessage(`Import into "${preview.environment}":`);
	for (const { key, kind, robloxId } of imports) {
		clack.logMessage(`< ${kind}:${key} (id ${robloxId}) import`);
	}

	return true;
}

function renderPreview(preview: DiffPreview, clack: ClackPort): boolean {
	renderConcurrentHold(preview, clack);
	const reports = preview.declarationReports ?? [];
	for (const report of reports) {
		clack.logMessage(declarationReportLine(report));
	}

	const hasImports = renderImports(preview, clack);
	const drift = (preview.drift ?? preview.ops).filter(isDriftOp);
	if (drift.length === 0) {
		const hasPendingPublish = renderPendingRebuild(preview, clack);
		if (!hasPendingPublish && !hasImports) {
			clack.logSuccess(`No drift for "${preview.environment}"`);
		}

		renderRedactions(preview, clack);
		const hasLiveEdits = renderLiveCheck(preview, clack);
		return hasImports || hasPendingPublish || hasLiveEdits;
	}

	clack.logMessage(`Drift for "${preview.environment}":`);
	const deferred = new Set(
		(preview.deferredCreates ?? []).map(({ key, kind }) => `${kind}:${key}`),
	);
	for (const op of drift) {
		clack.logMessage(describeOp(op, deferred));
	}

	renderBadgeNotes(preview, clack);

	renderLiveCheck(preview, clack);
	renderPendingRebuild(preview, clack);
	renderRedactions(preview, clack);

	return true;
}

async function dispatchEnvironmentsAsync({
	allowSpend,
	config,
	environments,
	failOnOutOfBandEdit,
	getEnv,
	live,
	plugins,
	resolved,
}: DispatchInputs): Promise<DispatchOutcome> {
	const failed: Array<string> = [];
	let hasDrift = false;
	for (const environment of environments) {
		const result = await resolved.previewDiff({
			...liveOptionsFor({ failOnOutOfBandEdit, live }),
			...(allowSpend ? { allowSpend } : {}),
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
			if (result.err.kind === "liveCheckFailed") {
				resolved.clack.logError(
					`live check failed for ${result.err.resourceKind}: ${result.err.cause.message}`,
				);
			} else {
				renderDeployError(result.err, resolved.clack);
			}

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

	const { clack, loaded, parsed } = started.data;
	const outcome = await dispatchEnvironmentsAsync({
		...liveOptionsFor(parsed),
		allowSpend: parsed.allowSpend === true,
		config: loaded.config,
		environments: parsed.environments,
		getEnv: buildEnvironmentReader(parsed),
		plugins: loaded.plugins,
		resolved: { ...resolved, clack },
	});
	if (outcome.failed.length > 0) {
		cancelAsFailed(resolved.clack);
		return EXIT_ERROR;
	}

	resolved.clack.outro(outroFor(outcome.hasDrift));
	return EXIT_OK;
}
