import type { BedrockState, StateError, StatePort } from "@bedrock-rbx/core";
import type { Result } from "@bedrock-rbx/ocale";

const DEFAULT_ATTEMPTS = 6;
const DEFAULT_BASE_DELAY_MS = 250;

/**
 * Options controlling a read-after-write convergence poll.
 */
export interface ReadStateUntilOptions {
	/** Maximum number of read attempts before giving up. Defaults to 6. */
	readonly attempts?: number | undefined;
	/** First inter-attempt delay in ms; doubles each retry. Defaults to 250. */
	readonly baseDelayMs?: number | undefined;
	/** Environment whose state file to read. */
	readonly environment: string;
	/**
	 * Convergence test. Polling stops once this returns true for the data of a
	 * successful read; it is never called for a failed or absent read.
	 */
	readonly predicate: (state: BedrockState) => boolean;
	/**
	 * Injection seam for backoff timing; defaults to a `setTimeout`-based
	 * promise. Tests pass a fake to keep retry assertions deterministic.
	 */
	readonly sleep?: ((ms: number) => Promise<void>) | undefined;
	/** State port to read from. */
	readonly statePort: Pick<StatePort, "read">;
}

/**
 * Polls `statePort.read` until the just-written state propagates, working
 * around GitHub gist's lack of read-your-write across replicas: a read issued
 * right after a successful write can still serve a stale replica. The write
 * adapter's own visibility poll only proves one GET saw the new content; this
 * backstops the consumer's subsequent independent read, which can land on a
 * lagging replica.
 *
 * Returns as soon as a successful read's data satisfies `predicate`. A failed
 * or absent read counts as not-yet-converged and is retried. After exhausting
 * the attempt budget the last read result is returned unchanged, so the caller
 * still sees the stale value (or error) and can assert against it.
 * @param options - Read target, convergence predicate, and retry budget.
 * @returns The first converged read, or the last read once the budget is spent.
 */
export async function readStateUntil(
	options: ReadStateUntilOptions,
): Promise<Result<BedrockState | undefined, StateError>> {
	const {
		attempts = DEFAULT_ATTEMPTS,
		baseDelayMs = DEFAULT_BASE_DELAY_MS,
		environment,
		predicate,
		sleep = defaultSleep,
		statePort,
	} = options;

	let result = await statePort.read(environment);
	for (let attempt = 1; attempt < attempts; attempt += 1) {
		if (result.success && result.data !== undefined && predicate(result.data)) {
			return result;
		}

		await sleep(baseDelayMs * 2 ** (attempt - 1));
		result = await statePort.read(environment);
	}

	return result;
}

async function defaultSleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}
