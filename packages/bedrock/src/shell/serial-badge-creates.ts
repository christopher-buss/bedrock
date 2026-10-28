import { BadgeCostMismatchError, type OpenCloudError, type Result } from "@bedrock-rbx/ocale";

import type { ResourceCurrentState } from "../core/resources.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import type { ResourceKey } from "../types/ids.ts";

type BadgeDriver = ResourceDriver<"badge">;
type Created = Result<ResourceCurrentState<"badge">, OpenCloudError>;
type Refusal = BadgeCostMismatchError | undefined;

interface Turn {
	/** Settles once the create before this one has. */
	readonly after: Promise<Refusal>;
	/** Settles this create, with the cost refusal later creates repeat. */
	readonly settle: (refusal: Refusal) => void;
}

/**
 * Wrap a badge Driver so its creates run one at a time in the given order,
 * whenever Apply calls them: each create waits for the one before it in
 * `order` to settle. After the first create Roblox refuses for cost, every
 * later create returns that refusal without sending a request. A create
 * whose Key is not in `order` runs without waiting.
 *
 * @param driver - The badge Driver to wrap.
 * @param order - The Keys of the badge creates Apply will run, in the order
 *   they must run.
 * @returns The Driver with serial creates.
 */
export function serialBadgeCreates(
	driver: BadgeDriver,
	order: ReadonlyArray<ResourceKey>,
): BadgeDriver {
	const turns = turnsFor(order);
	return {
		...driver,
		create: async (desired, context) => {
			const turn = turns.get(desired.key);
			if (turn === undefined) {
				return driver.create(desired, context);
			}

			const refusal = await turn.after;
			if (refusal !== undefined) {
				turn.settle(refusal);
				return { err: refusal, success: false };
			}

			try {
				const created: Created = await driver.create(desired, context);
				turn.settle(costRefusalOf(created));
				return created;
			} catch (err) {
				turn.settle(undefined);
				throw err;
			}
		},
	};
}

function turnsFor(order: ReadonlyArray<ResourceKey>): ReadonlyMap<ResourceKey, Turn> {
	const turns = new Map<ResourceKey, Turn>();
	let after = Promise.resolve<Refusal>(undefined);
	for (const key of order) {
		const own = Promise.withResolvers<Refusal>();
		turns.set(key, { after, settle: own.resolve });
		after = own.promise;
	}

	return turns;
}

function costRefusalOf(created: Created): Refusal {
	return !created.success && created.err instanceof BadgeCostMismatchError
		? created.err
		: undefined;
}
