import type { StateLockError, StateLockHold } from "@bedrock-rbx/core";

import { isLeaseExpired, renewalIntervalMs } from "./lease.ts";
import { type Acquisition, releaseAsync, renewLeaseAsync, type WonHold } from "./lock-object.ts";

/** What one held **Lease** runs on. */
export interface HeldLeaseInputs {
	/** The acquisition that won the hold. */
	readonly acquisition: Acquisition;
	/** Where a **Lease** that could not be kept is reported. */
	readonly onLeaseLost: ((error: StateLockError) => void) | undefined;
	/** The record on the object, and the tag it stands on. */
	readonly won: WonHold;
}

/** The hold as it stands, which each renewal moves on. */
interface StandingHold {
	/** The record on the object, and the tag the next write goes against. */
	held: WonHold;
	/** Whether the hold is another run's now. */
	lost: boolean;
}

/** What one renewal needs to know about the hold it is keeping alive. */
interface RenewalStep {
	/** The acquisition that won the hold. */
	readonly acquisition: Acquisition;
	/** Stops the schedule once there is nothing left to renew. */
	readonly cancel: () => void;
	/** Where a **Lease** that could not be kept is reported. */
	readonly onLeaseLost: ((error: StateLockError) => void) | undefined;
	/** The hold as it stands. */
	readonly standing: StandingHold;
}

/**
 * Hand back a hold that keeps its own **Lease** alive until it is given
 * up.
 *
 * Renewal runs on a schedule of its own from the moment the hold is won,
 * so a **Deploy** that outlives one lease keeps the **Environment** for as
 * long as it runs.
 *
 * Each renewal writes against the tag the last one answered with, and so
 * does the release, so a hold this run no longer has is never overwritten.
 *
 * @param inputs - The acquisition that won, the hold it won, and where to
 * report a lease it could not keep.
 * @returns The hold the deploy shell gives up when the work is over.
 */
export function holdWithRenewedLease({
	acquisition,
	onLeaseLost,
	won,
}: HeldLeaseInputs): StateLockHold {
	const standing: StandingHold = { held: won, lost: false };
	let renewals: Promise<void> = Promise.resolve();

	const cancel = acquisition.seams.scheduleEvery(
		renewalIntervalMs(acquisition.seams.leaseMs),
		async () => {
			renewals = renewals.then(async () => {
				return renewOnceAsync({ acquisition, cancel, onLeaseLost, standing });
			});
			await renewals;
		},
	);

	return {
		async release() {
			standing.lost = true;
			cancel();
			// A renewal already in flight settles first, so the tombstone is
			// written against the tag that renewal left the hold standing on.
			await renewals;
			return releaseAsync(acquisition, standing.held);
		},
	};
}

/**
 * Push one hold's deadline out, and read what the store made of it.
 *
 * A refusal a later renewal might not meet leaves the hold standing until
 * its own deadline. A refusal of the write the hold is conditional on
 * means another run has the **Environment** now, and there is nothing left
 * to renew.
 *
 * @param step - The acquisition, the hold as it stands, what stops the
 * schedule, and where a lease that could not be kept is reported.
 */
async function renewOnceAsync({
	acquisition,
	cancel,
	onLeaseLost,
	standing,
}: RenewalStep): Promise<void> {
	if (standing.lost) {
		return;
	}

	const renewal = await renewLeaseAsync(acquisition, standing.held);
	if (renewal.kind === "renewed") {
		standing.held = renewal.held;
		return;
	}

	if (
		renewal.kind === "failed" &&
		!isLeaseExpired(standing.held.record, acquisition.seams.now())
	) {
		return;
	}

	standing.lost = true;
	cancel();
	onLeaseLost?.(renewal.error);
}
