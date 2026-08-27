import type { StateLockError, StateLockHold, StateLockPort } from "#src/ports/state-lock-port";

/** A fake **State lock port** plus the log of what the deploy did with it. */
export interface FakeStateLock {
	/** Environments a hold was asked for, in call order. */
	readonly acquired: ReadonlyArray<string>;
	/** The port to hand to `deploy`. */
	readonly port: StateLockPort;
	/** Environments whose hold was given up, in release order. */
	readonly released: ReadonlyArray<string>;
}

/** What a fake lock does when asked for a hold or asked to give one up. */
interface FakeStateLockOptions {
	/** Refusal to return from `acquire`; omit to grant the hold. */
	readonly refuseAcquire?: StateLockError;
	/** Refusal to return from `release`; omit to give the hold up cleanly. */
	readonly refuseRelease?: StateLockError;
}

/** One granted hold plus the log it records its release in. */
interface HoldInputs {
	/** Environment the hold covers. */
	readonly environment: string;
	/** Refusal to return from `release`; omit to give the hold up cleanly. */
	readonly refuseRelease: StateLockError | undefined;
	/** Log each release appends its environment to. */
	readonly released: Array<string>;
}

/**
 * Report who holds an **Environment** in a test that never asks.
 *
 * A **Deploy** takes a hold rather than asking who has one, so a fake
 * reached here is answering a question the shell should not have put.
 *
 * @returns Never; the question is one the shell should not have put.
 * @rejects Always, naming the question that should not have been asked.
 */
export async function neverInspectAsync(): Promise<never> {
	// Settle on a later microtask, as a real lock store does.
	await Promise.resolve();
	throw new Error("a deploy must not ask who holds the environment");
}

/**
 * Build a **State lock port** that records what the deploy shell asked of
 * it, so a test states the hold's lifetime rather than the store's.
 *
 * @param options - Whether acquire or release refuses; both grant by
 * default.
 * @returns The port plus the acquire and release logs it appends to.
 */
export function fakeStateLock(options: FakeStateLockOptions = {}): FakeStateLock {
	const acquired: Array<string> = [];
	const released: Array<string> = [];

	return {
		acquired,
		port: {
			acquire: async (environment) => {
				acquired.push(environment);
				const { refuseRelease } = options;
				// Settle on a later microtask, as a real lock store does.
				await Promise.resolve();
				return options.refuseAcquire === undefined
					? {
							data: grantHold({ environment, refuseRelease, released }),
							success: true,
						}
					: { err: options.refuseAcquire, success: false };
			},
			inspect: neverInspectAsync,
		},
		released,
	};
}

/**
 * Build the hold `acquire` hands back, which logs the environment it covers
 * when the deploy gives it up.
 *
 * @param inputs - The environment held, the release log, and whether the
 * release refuses.
 * @returns A hold that logs the environment it covered when released.
 */
function grantHold({ environment, refuseRelease, released }: HoldInputs): StateLockHold {
	return {
		release: async () => {
			released.push(environment);
			// Settle on a later microtask, as a real lock store does.
			await Promise.resolve();
			return refuseRelease === undefined
				? { data: undefined, success: true }
				: { err: refuseRelease, success: false };
		},
	};
}
