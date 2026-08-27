import type { Result } from "@bedrock-rbx/ocale";

/**
 * Why a hold could not be taken or could not be given up.
 *
 * Core renders `reason` and passes `detail` through untouched, so a
 * **Backend** carries its own payload (the recorded holder, the deadline it
 * read) without core enumerating the shapes a lock store can fail in.
 *
 * @since unreleased
 */
export interface StateLockError {
	/** The **Backend**'s own payload, which core neither reads nor narrows. */
	readonly detail?: unknown;
	/** Human-readable explanation of what went wrong. */
	readonly reason: string;
}

/**
 * What a **Backend** reports each time it backs off while another run holds
 * the **Environment**, so a queued deploy is visible rather than silent.
 *
 * `holder` is best effort. Reading the current holder's record is exactly
 * what fails under contention, and a **Backend** keeps retrying without it,
 * so the field is absent whenever the read did not land.
 *
 * @since unreleased
 */
export interface StateLockWaiting {
	/** Milliseconds spent waiting so far. */
	readonly elapsedMs: number;
	/** Who holds the **Environment**, absent when the record was unreadable. */
	readonly holder?: string | undefined;
	/** Milliseconds left before acquisition gives up. */
	readonly remainingMs: number;
}

/**
 * What the caller tells a **Backend** about the hold it is asking for.
 *
 * Both fields are optional, so a **Backend** that neither records what the
 * hold is for nor waits under contention implements
 * {@link StateLockPort.acquire} with the environment alone.
 *
 * @since unreleased
 */
export interface StateLockAcquireOptions {
	/**
	 * Called each time the **Backend** backs off under contention. Core
	 * forwards it to the **Progress port**, which is what keeps a queued
	 * deploy from looking like a hang.
	 *
	 * @param waiting - How long the wait has run and who holds the
	 * **Environment**, when the **Backend** could read that.
	 */
	readonly onWaiting?: (waiting: StateLockWaiting) => void;
	/**
	 * What the hold is being taken for, recorded by a **Backend** whose lock
	 * record carries it so a blocked run can name what it is waiting on.
	 */
	readonly operation?: string;
}

/**
 * A hold taken on one **Environment**, handed back so the deploy shell can
 * give it up when the work is over.
 *
 * @since unreleased
 */
export interface StateLockHold {
	/**
	 * Give the hold up.
	 *
	 * A deploy releases once the **State** write has been *attempted*,
	 * whether that attempt succeeded or failed: a write that fails after
	 * **Apply** is exactly when the operator needs to run again, and holding
	 * the **Environment** until the **Lease** expires would make that
	 * recovery wait on a timeout.
	 *
	 * Returns a `Result` so a **Backend** can report a hold it could not give
	 * up. The deploy never lets that outcome change its own: the failure
	 * carrying the unrecorded resources must reach the operator intact.
	 */
	release(): Promise<Result<void, StateLockError>>;
}

/**
 * Optional plugin contract for mutual exclusion around a **Deploy**: the
 * interface a **Backend** implements to keep two runs from applying against
 * one **Environment** at once. Sibling of
 * {@link "./state-port".StatePort} and, like it, a *driven* (secondary)
 * port.
 *
 * Exclusion is taken before the work rather than detected after it. A
 * **Deploy** applies its **Operation**s against Roblox before it writes
 * **State**, so two concurrent runs have already created resources by the
 * time either could notice a conflict at write time.
 *
 * A **Backend** that cannot offer atomic create-if-absent declares no
 * locking and is still a valid **Backend**; the guarantee in force is
 * reportable rather than discovered during an incident.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import type { StateLockPort } from "@bedrock-rbx/core";
 *
 * const held = new Set<string>();
 *
 * const lockPort: StateLockPort = {
 *     async acquire(environment) {
 *         if (held.has(environment)) {
 *             return { err: { reason: `${environment} is already held` }, success: false };
 *         }
 *
 *         held.add(environment);
 *         return {
 *             data: {
 *                 release: async () => {
 *                     held.delete(environment);
 *                     return { data: undefined, success: true };
 *                 },
 *             },
 *             success: true,
 *         };
 *     },
 * };
 *
 * return lockPort.acquire("production").then(async (first) => {
 *     expect(first.success).toBeTrue();
 *
 *     const second = await lockPort.acquire("production");
 *     expect(second.success).toBeFalse();
 *
 *     if (first.success) {
 *         await first.data.release();
 *     }
 *
 *     const third = await lockPort.acquire("production");
 *     expect(third.success).toBeTrue();
 * });
 * ```
 */
export interface StateLockPort {
	/**
	 * Take a hold on one **Environment**, before any **Operation** is
	 * applied.
	 *
	 * - Returns `Ok(StateLockHold)` once the hold is the caller's.
	 * - Returns `Err(StateLockError)` when it is not, which aborts the deploy
	 *   before anything is applied.
	 *
	 * @param environment - **Environment** to take the hold on.
	 * @param options - What the hold is for, and where to report a wait.
	 */
	acquire(
		environment: string,
		options?: StateLockAcquireOptions,
	): Promise<Result<StateLockHold, StateLockError>>;
}
