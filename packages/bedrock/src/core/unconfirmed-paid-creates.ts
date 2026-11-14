import { badgeCreatesIn } from "./capacity-check.ts";
import type { Operation } from "./operations.ts";
import type { ResourceCurrentState } from "./resources.ts";
import type { ResolvedConfig } from "./schema.ts";
import type { BedrockState, UnconfirmedPaidCreate } from "./state.ts";

/**
 * Clear the **Unconfirmed paid creates** the user confirms made no badge.
 *
 * @param state - Saved State of the Environment.
 * @param confirmed - Keys the user confirms Roblox made no badge for.
 * @returns State without those markers.
 */
export function withoutConfirmed(
	state: BedrockState | undefined,
	confirmed: ReadonlyArray<string> | undefined,
): BedrockState | undefined {
	if (state?.unconfirmedPaidCreates === undefined) {
		return state;
	}

	const keys = new Set(confirmed);
	return {
		...state,
		unconfirmedPaidCreates: state.unconfirmedPaidCreates.filter(({ key }) => !keys.has(key)),
	};
}

/**
 * Keep the **Unconfirmed paid creates** that stop a create: those for a
 * declared badge. Importing or adopting a badge clears its marker, so a
 * marked Key is never tracked.
 *
 * @param config - Effective config of the Environment.
 * @param state - Saved State, with or without the imports added.
 * @returns The Unconfirmed paid creates whose Key would be created.
 */
export function blockingUnconfirmed(
	config: Pick<ResolvedConfig, "badges">,
	state: Pick<BedrockState, "unconfirmedPaidCreates"> | undefined,
): ReadonlyArray<UnconfirmedPaidCreate> {
	const declared = new Set(Object.keys(config.badges ?? {}));
	return (state?.unconfirmedPaidCreates ?? []).filter(({ key }) => declared.has(key));
}

/**
 * Clear the **Unconfirmed paid creates** of the badges a run imported: the
 * import tracks the badge Roblox made, so no create is left to pay for.
 *
 * @param state - State with the imports added.
 * @param imported - The items the run imported.
 * @returns State without the markers of imported badges.
 */
export function withoutImported(
	state: BedrockState,
	imported: ReadonlyArray<ResourceCurrentState>,
): BedrockState {
	if (state.unconfirmedPaidCreates === undefined) {
		return state;
	}

	const badges = new Set(
		imported.filter((resource) => resource.kind === "badge").map(({ key }) => key),
	);
	return {
		...state,
		unconfirmedPaidCreates: state.unconfirmedPaidCreates.filter(({ key }) => !badges.has(key)),
	};
}

/**
 * Drop the badge creates an **Unconfirmed paid create** holds, as a Deploy
 * that allows Deferred creates skips them.
 *
 * @param ops - The Operations of the Diff.
 * @param held - The Unconfirmed paid creates that stop a create.
 * @returns The Operations without the held badge creates.
 */
export function withoutHeldCreates(
	ops: ReadonlyArray<Operation>,
	held: ReadonlyArray<UnconfirmedPaidCreate>,
): ReadonlyArray<Operation> {
	const keys = new Set(held.map(({ key }) => key));
	const dropped = new Set<Operation>(badgeCreatesIn(ops).filter((op) => keys.has(op.key)));
	return ops.filter((op) => !dropped.has(op));
}
