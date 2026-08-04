import type { ApplyError, DeployError } from "@bedrock-rbx/core";
import { ApiError } from "@bedrock-rbx/ocale";

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 2_000;

/**
 * Matches an Open Cloud server error as the CLI renders it, e.g.
 * `place.smoke-place failed: HTTP 500 (body: ...)`. The programmatic path gets
 * the typed {@link isTransientDeployFailure} instead; a spawned CLI only hands
 * back stdout and stderr, so text is the only signal available there.
 */
const HTTP_SERVER_ERROR_TEXT = /\bHTTP 5\d\d\b/u;

/**
 * Options controlling a transient-failure retry loop.
 *
 * @template T - Outcome type the operation resolves to.
 */
export interface RetryTransientOptions<T> {
	/** Maximum number of attempts before giving up. Defaults to 3. */
	readonly attempts?: number | undefined;
	/** First inter-attempt delay in ms; doubles each retry. Defaults to 2000. */
	readonly baseDelayMs?: number | undefined;
	/** Returns true when the outcome is a failure worth re-attempting. */
	readonly isTransient: (outcome: T) => boolean;
	/** The operation to attempt. Must be safe to repeat. */
	readonly operation: () => Promise<T>;
	/**
	 * Injection seam for backoff timing; defaults to a `setTimeout`-based
	 * promise. Tests pass a fake to keep retry assertions deterministic.
	 */
	readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

/**
 * Re-attempts an operation while its outcome looks like a transient upstream
 * failure. Roblox Open Cloud occasionally answers a place publish with a 5xx,
 * and `@bedrock-rbx/ocale` deliberately does not retry that in production: a
 * 5xx comes from Open Cloud and may describe a write that partly landed, so a
 * library-level retry could duplicate a resource. The smoke suite has no such
 * constraint — it publishes the same fixture to a dedicated test place, which
 * Roblox dedupes by content — so it absorbs the flake here rather than
 * loosening the production policy.
 *
 * After exhausting the attempt budget the last outcome is returned unchanged,
 * so the caller still sees the failure and can assert against it.
 *
 * @template T - Outcome type the operation resolves to.
 * @param options - Operation, transience test, and retry budget.
 * @returns The first non-transient outcome, or the last one once the budget is spent.
 */
export async function retryTransient<T>(options: RetryTransientOptions<T>): Promise<T> {
	const {
		attempts = DEFAULT_ATTEMPTS,
		baseDelayMs = DEFAULT_BASE_DELAY_MS,
		isTransient,
		operation,
		sleep = defaultSleep,
	} = options;

	let outcome = await operation();
	for (let attempt = 1; attempt < attempts; attempt += 1) {
		if (!isTransient(outcome)) {
			return outcome;
		}

		await sleep(baseDelayMs * 2 ** (attempt - 1));
		outcome = await operation();
	}

	// The attempt taken on the final iteration is a budget attempt: it is
	// returned unchecked so the caller sees the last outcome and can assert.
	return outcome;
}

/**
 * True when a `deploy` failure is wholly attributable to Open Cloud server
 * errors, and so is worth re-attempting. A batch mixing a server error with a
 * permanent one is not transient: re-running it would keep failing on the
 * permanent half and only delay the report. The batch is non-empty by type,
 * so `every` cannot vacuously report a clean deploy as retryable.
 * @param err - The `DeployError` a failed `deploy` returned.
 * @returns True if every failure in the batch was an Open Cloud 5xx.
 */
export function isTransientDeployFailure(err: DeployError): boolean {
	if (err.kind !== "applyFailed") {
		return false;
	}

	return err.cause.failures.every(isTransientApplyFailure);
}

/**
 * True when spawned-CLI output reports an Open Cloud server error. Coarser
 * than {@link isTransientDeployFailure} because a child process surfaces only
 * text, so this cannot tell a wholly-transient batch from a mixed one; a
 * permanent failure alongside a 5xx costs one wasted re-attempt.
 * @param output - Combined stdout and stderr from the CLI run.
 * @returns True if the output mentions an HTTP 5xx.
 */
export function hasTransientApiFailureText(output: string): boolean {
	return HTTP_SERVER_ERROR_TEXT.test(output);
}

async function defaultSleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

function isTransientApplyFailure(failure: ApplyError): boolean {
	return (
		failure.kind === "driverFailure" &&
		failure.cause instanceof ApiError &&
		failure.cause.statusCode >= 500 &&
		failure.cause.statusCode < 600
	);
}
